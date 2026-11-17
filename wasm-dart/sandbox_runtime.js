// Copyright (c) 2015, the Dart project authors.  Please see the AUTHORS file
// for details. All rights reserved. Use of this source code is governed by a
// BSD-style license that can be found in the LICENSE file.

// This file defines the module loader for the dart runtime.
if (!self.dart_library) {
  self.dart_library = typeof module != 'undefined' && module.exports || {};

  (function (dart_library) {
    'use strict';

    // Throws an error related to module loading.
    //
    // This does not throw a Dart error because the Dart SDK may not have loaded
    // yet, and module loading errors cannot be caught by Dart code.
    function throwLibraryError(message) {
      // Dispatch event to allow others to react to the load error without
      // capturing the exception.
      if (!!self.dispatchEvent) {
        self.dispatchEvent(
          new CustomEvent('dartLoadException', { detail: message }));
      }
      throw Error(message);
    }

    /**
     * Returns true if we're running in d8.
     *
     * TODO(markzipan): Determine if this d8 check is too inexact.
     */
    self.dart_library.isD8 = self.document.head == void 0;

    const libraryImports = Symbol('libraryImports');
    self.dart_library.libraryImports = libraryImports;

    const _metrics = Symbol('metrics');

    // Returns a map from module name to various metrics for module.
    function moduleMetrics() {
      const map = {};
      const keys = Array.from(_libraries.keys());
      for (const key of keys) {
        const lib = _libraries.get(key);
        map[lib._name] = lib.firstLibraryValue[_metrics];
      }
      return map;
    }
    self.dart_library.moduleMetrics = moduleMetrics;

    // Returns an application level overview of the module metrics.
    function appMetrics() {
      const metrics = moduleMetrics();
      let dartSize = 0;
      let jsSize = 0;
      let sourceMapSize = 0;
      let evaluatedModules = 0;
      const keys = Array.from(_libraries.keys());

      let firstLoadStart = Number.MAX_VALUE;
      let lastLoadEnd = Number.MIN_VALUE;

      for (const module of keys) {
        let data = metrics[module];
        if (data != null) {
          evaluatedModules++;
          dartSize += data.dartSize;
          jsSize += data.jsSize;
          sourceMapSize += data.sourceMapSize;
          firstLoadStart = Math.min(firstLoadStart, data.loadStart);
          lastLoadEnd = Math.max(lastLoadEnd, data.loadEnd);
        }
      }
      let loadTimeMs =
        lastLoadEnd === Number.MIN_VALUE ? 0 : lastLoadEnd - firstLoadStart;
      return {
        'dartSize': dartSize,
        'jsSize': jsSize,
        'sourceMapSize': sourceMapSize,
        'evaluatedModules': evaluatedModules,
        'loadTimeMs': loadTimeMs
      };
    }
    self.dart_library.appMetrics = appMetrics;

    function _sortFn(key1, key2) {
      const t1 = _libraries.get(key1).firstLibraryValue[_metrics].loadStart;
      const t2 = _libraries.get(key2).firstLibraryValue[_metrics].loadStart;
      return t1 - t2;
    }

    // Convenience method to print the metrics in the browser console
    // in CSV format.
    function metricsCsv() {
      let buffer =
        'Module, JS Size, Dart Size, Load Start, Load End, Cumulative JS Size\n';
      const keys = Array.from(_libraries.keys());
      keys.sort(_sortFn);
      let cumulativeJsSize = 0;
      for (const key of keys) {
        const lib = _libraries.get(key);
        const jsSize = lib.firstLibraryValue[_metrics].jsSize;
        cumulativeJsSize += jsSize;
        const dartSize = lib.firstLibraryValue[_metrics].dartSize;
        const loadStart = lib.firstLibraryValue[_metrics].loadStart;
        const loadEnd = lib.firstLibraryValue[_metrics].loadEnd;
        buffer += '"' + lib._name + '", ' + jsSize + ', ' + dartSize + ', ' +
          loadStart + ', ' + loadEnd + ', ' + cumulativeJsSize + '\n';
      }
      return buffer;
    }
    self.dart_library.metricsCsv = metricsCsv;

    // Module support.  This is a simplified module system for Dart.
    // Longer term, we can easily migrate to an existing JS module system:
    // ES6, AMD, RequireJS, ....

    // Returns a proxy that delegates to the underlying loader.
    // This defers loading of a module until a library is actually used.
    const loadedModule = Symbol('loadedModule');
    self.dart_library.defer = function (module, name, patch) {
      let done = false;
      function loadDeferred() {
        done = true;
        let mod = module[loadedModule];
        let lib = mod[name];
        // Install unproxied module and library in caller's context.
        patch(mod, lib);
      }
      // The deferred library object.  Note, the only legal operations on a Dart
      // library object should be get (to read a top-level variable, method, or
      // Class) or set (to write a top-level variable).
      return new Proxy({}, {
        get: function (o, p) {
          if (!done) loadDeferred();
          return module[name][p];
        },
        set: function (o, p, value) {
          if (!done) loadDeferred();
          module[name][p] = value;
          return true;
        },
      });
    };

    let _reverseImports = new Map();

    // App name to set of libraries that were not only loaded on the page but
    // also executed.
    const _executedLibraries = new Map();
    self.dart_library.executedLibraryCount = function () {
      let count = 0;
      _executedLibraries.forEach(function (executedLibraries, _) {
        count += executedLibraries.size;
      });
      return count;
    };

    // Library instance that is going to be loaded or has been loaded.
    class LibraryInstance {
      constructor(libraryValue) {
        this.libraryValue = libraryValue;
        // Cyclic import detection
        this.loadingState = LibraryLoader.NOT_LOADED;
      }

      get isNotLoaded() {
        return this.loadingState == LibraryLoader.NOT_LOADED;
      }
    }

    class LibraryLoader {
      constructor(name, defaultLibraryValue, imports, loader, data) {
        imports.forEach(function (i) {
          let deps = _reverseImports.get(i);
          if (!deps) {
            deps = new Set();
            _reverseImports.set(i, deps);
          }
          deps.add(name);
        });
        this._name = name;
        this._defaultLibraryValue =
          defaultLibraryValue ? defaultLibraryValue : {};
        this._imports = imports;
        this._loader = loader;
        data.jsSize = loader.toString().length;
        data.loadStart = NaN;
        data.loadEnd = NaN;
        this._metrics = data;

        // First loaded instance for supporting logic that assumes there is only
        // one app.
        // TODO(b/204209941): Remove _firstLibraryInstance after debugger and
        // metrics support multiple apps.
        this._firstLibraryInstance =
          new LibraryInstance(this._deepCopyDefaultValue());
        this._firstLibraryInstanceUsed = false;

        // App name to instance map.
        this._instanceMap = new Map();
      }

      /// First loaded value for supporting logic that assumes there is only
      /// one app.
      get firstLibraryValue() {
        return this._firstLibraryInstance.libraryValue;
      }

      /// The loaded instance value for the given `appName`.
      libraryValueInApp(appName) {
        return this._instanceMap.get(appName).libraryValue;
      }

      load(appName) {
        let instance = this._instanceMap.get(appName);
        if (!instance && !this._firstLibraryInstanceUsed) {
          // If `_firstLibraryInstance` is already assigned to an app, creates a
          // new instance clone (with deep copy) and assigns it the given app.
          // Otherwise, reuse `_firstLibraryInstance`.
          instance = this._firstLibraryInstance;
          this._firstLibraryInstanceUsed = true;
          this._instanceMap.set(appName, instance);
        }
        if (!instance) {
          instance = new LibraryInstance(this._deepCopyDefaultValue());
          this._instanceMap.set(appName, instance);
        }

        // Check for cycles
        if (instance.loadingState == LibraryLoader.LOADING) {
          throwLibraryError('Circular dependence on library: ' + this._name);
        } else if (instance.loadingState >= LibraryLoader.READY) {
          return instance.libraryValue;
        }
        if (!_executedLibraries.has(appName)) {
          _executedLibraries.set(appName, new Set());
        }
        _executedLibraries.get(appName).add(this._name);
        instance.loadingState = LibraryLoader.LOADING;

        // Handle imports
        let args = this._loadImports(appName);

        // Load the library
        let loader = this;
        let library = instance.libraryValue;

        library[libraryImports] = this._imports;
        library[loadedModule] = library;
        library[_metrics] = this._metrics;
        args.unshift(library);

        if (this._name == 'dart_sdk') {
          // Eagerly load the SDK.
          if (!!self.performance && !!self.performance.now) {
            library[_metrics].loadStart = self.performance.now();
          }
          this._loader.apply(null, args);
          if (!!self.performance && !!self.performance.now) {
            library[_metrics].loadEnd = self.performance.now();
          }
        } else {
          // Load / parse other modules on demand.
          let done = false;
          instance.libraryValue = new Proxy(library, {
            get: function (o, name) {
              if (name == _metrics) {
                return o[name];
              }
              if (!done) {
                done = true;
                if (!!self.performance && !!self.performance.now) {
                  library[_metrics].loadStart = self.performance.now();
                }
                loader._loader.apply(null, args);
                if (!!self.performance && !!self.performance.now) {
                  library[_metrics].loadEnd = self.performance.now();
                }
              }
              return o[name];
            }
          });
        }

        instance.loadingState = LibraryLoader.READY;
        return instance.libraryValue;
      }

      _loadImports(appName) {
        let results = [];
        for (let name of this._imports) {
          results.push(import_(name, appName));
        }
        return results;
      }

      _deepCopyDefaultValue() {
        return JSON.parse(JSON.stringify(this._defaultLibraryValue));
      }
    }
    LibraryLoader.NOT_LOADED = 0;
    LibraryLoader.LOADING = 1;
    LibraryLoader.READY = 2;

    // Map from name to LibraryLoader
    let _libraries = new Map();
    self.dart_library.libraries = function () {
      return _libraries.keys();
    };
    self.dart_library.debuggerLibraries = function () {
      let debuggerLibraries = [];
      _libraries.forEach(function (value, key, map) {
        debuggerLibraries.push(value.load(_firstStartedAppName));
      });
      Object.setPrototypeOf(debuggerLibraries, null);
      return debuggerLibraries;
    };

    // Invalidate a library and all things that depend on it
    function _invalidateLibrary(name) {
      let lib = _libraries.get(name);
      if (lib._instanceMap.size === 0) return;
      lib._firstLibraryInstance =
        new LibraryInstance(lib._deepCopyDefaultValue());
      lib._firstLibraryInstanceUsed = false;
      lib._instanceMap.clear();
      let deps = _reverseImports.get(name);
      if (!deps) return;
      deps.forEach(_invalidateLibrary);
    }

    function library(name, defaultLibraryValue, imports, loader, data = {}) {
      let result = _libraries.get(name);
      if (result) {
        console.log('Re-loading ' + name);
        _invalidateLibrary(name);
      }
      result =
        new LibraryLoader(name, defaultLibraryValue, imports, loader, data);
      _libraries.set(name, result);
      return result;
    }
    self.dart_library.library = library;

    // Local storage may be blocked by a browser policy in which case even
    // trying to access it will throw.
    function isLocalStorageAvailable() {
      try {
        !!self.localStorage;
        return true;
      } catch (e) {
        return false;
      }
    }

    // Store executed modules upon reload.
    if (!!self.addEventListener && isLocalStorageAvailable()) {
      self.addEventListener('beforeunload', function (event) {
        _nameToApp.forEach(function (_, appName) {
          if (!_executedLibraries.get(appName)) {
            return;
          }
          let libraryCache = {
            'time': new Date().getTime(),
            'modules': Array.from(_executedLibraries.get(appName).keys()),
          };
          self.localStorage.setItem(
            `dartLibraryCache:${appName}`, JSON.stringify(libraryCache));
        });
      });
    }

    // Map from module name to corresponding app to proxy library map.
    let _proxyLibs = new Map();

    /**
     * Returns an instantiated module given its module name.
     *
     * Note: this method is not meant to be used outside DDC generated code,
     * however it is currently being used in many places because DDC lacks an
     * Embedding API. This API will be removed in the future once the Embedding
     * API is established.
     */
    function import_(name, appName) {
      // For backward compatibility.
      if (!appName && _lastStartedSubapp) {
        appName = _lastStartedSubapp.appName;
      }

      let proxy;
      if (_proxyLibs.has(name)) {
        proxy = _proxyLibs.get(name).get(appName);
      }
      if (proxy) return proxy;
      let proxyLib = new Proxy({}, {
        get: function (o, p) {
          let lib = _libraries.get(name);
          if (self.$dartJITModules) {
            // The backing module changed so update the reference
            if (!lib) {
              let xhr = new XMLHttpRequest();
              let sourceURL = self.$dartLoader.moduleIdToUrl.get(name);
              xhr.open('GET', sourceURL, false);
              xhr.withCredentials = true;
              xhr.send();
              // Add inline policy to make eval() call Trusted Types compatible
              // when running in a TT compatible browser
              let policy = {
                createScript: function (script) {
                  return script;
                }
              };
              if (self.trustedTypes && self.trustedTypes.createPolicy) {
                policy = self.trustedTypes.createPolicy(
                  'dartDdcModuleLoading#dart_library', policy);
              }
              // Append sourceUrl so the resource shows up in the Chrome
              // console.
              eval(policy.createScript(
                xhr.responseText + '//@ sourceURL=' + sourceURL));
              lib = _libraries.get(name);
            }
          }
          if (!lib) {
            throwLibraryError('Module ' + name + ' not loaded in the browser.');
          }
          // Always load the library before accessing a property as it may have
          // been invalidated.
          return lib.load(appName)[p];
        }
      });
      if (!_proxyLibs.has(name)) {
        _proxyLibs.set(name, new Map());
      }
      _proxyLibs.get(name).set(appName, proxyLib);
      return proxyLib;
    }
    self.dart_library.import = import_;

    // Removes the corresponding library and invalidates all things that
    // depend on it.
    function _invalidateImport(name) {
      let lib = _libraries.get(name);
      if (!lib) return;
      _invalidateLibrary(name);
      _libraries.delete(name);
    }
    self.dart_library.invalidateImport = _invalidateImport;

    let _debuggerInitialized = false;

    // Caches the last N runIds to prevent hot reload requests from the same
    // runId from executing more than once.
    const _hotRestartRunIdCache = new Array();

    // Called to initiate a hot restart of the application for a given uuid. If
    // it is not set, the last started application will be hot restarted.
    //
    // "Hot restart" means all application state is cleared, the newly compiled
    // modules are loaded, and `main()` is called.
    //
    // Note: `onReloadEnd()` can be provided, and if so will be used instead of
    // `main()` for hot restart.
    //
    // This happens in the following sequence:
    //
    // 1. Look for `onReloadStart()` in the same library that has `main()`, and
    //    call it if present. This function is implemented by the application to
    //    ensure any global browser/DOM state is cleared, so the application can
    //    restart.
    // 2. Wait for `onReloadStart()` to complete (either synchronously, or async
    //    if it returned a `Future`).
    // 3. Call dart:_runtime's `hotRestart()` function to clear any state that
    //    `dartdevc` is tracking, such as initialized static fields and type
    //    caches.
    // 4. Call `self.$dartReloadModifiedModules()` (provided by the HTML page)
    //    to reload the relevant JS modules, passing a callback that will invoke
    //    `main()`.
    // 5. `$dartReloadModifiedModules` calls the callback to rerun main.
    //
    async function hotRestart(config) {
      if (!self || !self.$dartReloadModifiedModules) {
        console.warn('Hot restart not supported in this environment.');
        return;
      }

      // If `config.runId` is set (e.g. a unique build ID that represent the
      // current build and shared by multiple subapps), skip the following runs
      // with the same id.
      if (config && config.runId) {
        if (_hotRestartRunIdCache.indexOf(config.runId) >= 0) {
          // The run has already started (by other subapp or app)
          return;
        }
        _hotRestartRunIdCache.push(config.runId);

        // Only cache the runIds for the last N runs. We assume that there are
        // less than N requests with different runId can happen in a very short
        // period of time (e.g. 1 second).
        if (_hotRestartRunIdCache.length > 10) {
          _hotRestartRunIdCache.shift();
        }
      }

      self.console.clear();
      const sdk = _libraries.get('dart_sdk');

      // Finds out what apps and their subapps should be hot restarted in
      // their starting order.
      const dirtyAppNames = new Array();
      const dirtySubapps = new Array();
      if (config && config.runId) {
        _nameToApp.forEach(function (app, appName) {
          dirtySubapps.push(...app.uuidToSubapp.values());
          dirtyAppNames.push(appName);
        });
      } else {
        dirtySubapps.push(_lastStartedSubapp);
        dirtyAppNames.push(_lastStartedSubapp.appName);
      }

      // Invokes onReloadStart for each subapp in reversed starting order.
      const onReloadStartPromises = new Array();
      for (const subapp of dirtySubapps.reverse()) {
        // Call the application's `onReloadStart()` function, if provided.
        if (subapp.library && subapp.library.onReloadStart) {
          const result = subapp.library.onReloadStart();
          if (result && result.then) {
            let resolve;
            onReloadStartPromises.push(new Promise(function (res, _) {
              resolve = res;
            }));
            const dart = sdk.libraryValueInApp(subapp.appName).dart;
            result.then(dart.dynamic, function () {
              resolve();
            });
          }
        }
      }
      // Reverse the subapps back to starting order.
      dirtySubapps.reverse();

      await Promise.all(onReloadStartPromises);

      // Invokes SDK `hotRestart` to reset all initialized fields and clears
      // type caches and other temporary data structures used by the
      // compiler/SDK.
      for (const appName of dirtyAppNames) {
        sdk.libraryValueInApp(appName).dart.hotRestart();
      }

      // Invoke `hotRestart` for the deferred loader to clear load ids and
      // other temporary state.
      if (self.deferred_loader) {
        self.deferred_loader.hotRestart();
      }

      // Starts the subapps in their starting order.
      for (const subapp of dirtySubapps) {
        // Call the module loader to reload the necessary modules.
        self.$dartReloadModifiedModules(subapp.appName, async function () {
          // If the promise `readyToRunMain` is provided, then wait for
          // it. This gives the debugging clients time to set any breakpoints.
          if (!!(config && config.readyToRunMain)) {
            await config.readyToRunMain;
          }
          // Once the modules are loaded, rerun `main()`.
          start(
            subapp.appName, subapp.uuid, subapp.moduleName,
            subapp.libraryName, true);
        });
      }
    }
    self.dart_library.reload = hotRestart;

    // Creates a script with the proper nonce value for strict CSP or noops on
    // invalid platforms.
    self.dart_library.createScript = (function () {
      // Exit early if we aren't modifying an HtmlElement (such as in D8).
      if (self.dart_library.isD8) return;
      // Find the nonce value. (Note, this is only computed once.)
      const scripts = Array.from(document.getElementsByTagName('script'));
      let nonce;
      scripts.some(
        script => (nonce = script.nonce || script.getAttribute('nonce')));
      // If present, return a closure that automatically appends the nonce.
      if (nonce) {
        return function () {
          let script = document.createElement('script');
          script.nonce = nonce;
          return script;
        };
      } else {
        return function () {
          return document.createElement('script');
        };
      }
    })();

    /// An App contains one or multiple Subapps, all of the subapps share the
    /// same memory copy of library instances, and as a result they share state
    /// in Dart statics and top-level fields. There can be one or multiple Apps
    /// in a browser window, all of the Apps are isolated from each other
    /// (i.e. they create different instances even for the same module).
    class App {
      constructor(name) {
        this.name = name;

        // Subapp's uuid to subapps in initial starting order.
        // (ES6 preserves iteration order)
        this.uuidToSubapp = new Map();
      }
    }

    class Subapp {
      constructor(uuid, appName, moduleName, libraryName, library) {
        this.uuid = uuid;
        this.appName = appName;
        this.moduleName = moduleName;
        this.libraryName = libraryName;
        this.library = library;

        this.originalBody = null;
      }
    }

    // App name to App map in initial starting order.
    // (ES6 preserves iteration order)
    const _nameToApp = new Map();
    let _firstStartedAppName;
    let _lastStartedSubapp;

    /**
     * Runs a Dart program's main method.
     *
     * Intended to be invoked by the bootstrapping code where the application
     * is being embedded.
     *
     * Because multiple programs can be part of a single application on a page
     * at once, we identify the entrypoint using multiple keys: `appName`
     * denotes the parent application, this program within that application
     * (aka. the subapp) is identified by an `uuid`. Finally the entrypoint
     * method is located from the `moduleName` and `libraryName`.
     *
     * Often, when a page contains a single app, the uuid is a fixed trivial
     * value like '00000000-0000-0000-0000-000000000000'.
     *
     * This is one of the current public Embedding APIs exposed by DDC.
     * Note: this API will be replaced by `dartDevEmbedder.runMain` in the
     * future.
     */
    function start(appName, uuid, moduleName, libraryName, isReload) {
      console.info(
        `DDC: Subapp Module [${appName}:${moduleName}:${uuid}] is starting`);
      if (libraryName == null) libraryName = moduleName;
      const library = import_(moduleName, appName)[libraryName];

      let app = _nameToApp.get(appName);
      if (!isReload) {
        if (!app) {
          app = new App(appName);
          _nameToApp.set(appName, app);
        }

        let subapp = app.uuidToSubapp.get(uuid);
        if (!subapp) {
          subapp = new Subapp(uuid, appName, moduleName, libraryName, library);
          app.uuidToSubapp.set(uuid, subapp);
        }

        _lastStartedSubapp = subapp;
        if (!_firstStartedAppName) {
          _firstStartedAppName = appName;
        }
      }

      const subapp = app.uuidToSubapp.get(uuid);
      const sdk = import_('dart_sdk', appName);

      if (!_debuggerInitialized) {
        // This import is only needed for chrome debugging. We should provide an
        // option to compile without it.
        sdk._debugger.registerDevtoolsFormatter();

        // Create isolate.
        _debuggerInitialized = true;
      }
      if (isReload) {
        // subapp may have been modified during reload, `subapp.library` needs
        // to always point to the latest data.
        subapp.library = library;

        if (library.onReloadEnd) {
          library.onReloadEnd();
          return;
        } else {
          if (!!self.document) {
            // Note: we expect originalBody to be undefined in non-browser
            // environments, but in that case so is the body.
            if (!subapp.originalBody && !!self.document.body) {
              self.console.warn('No body saved to update on reload');
            } else {
              self.document.body = subapp.originalBody;
            }
          }
        }
      } else {
        // If not a reload and `onReloadEnd` is not defined, store the initial
        // html to reset it on reload.
        if (!library.onReloadEnd && !!self.document && !!self.document.body) {
          subapp.originalBody = self.document.body.cloneNode(true);
        }
      }
      library.main([]);
    }
    dart_library.start = start;


    /**
     * Configure the DDC runtime.
     *
     * Must be called before invoking [start].
     *
     * The configuration parameter is an object that may provide any of the
     * following keys:
     *
     *   - weakNullSafetyErrors: throw errors when types violate sound null
     *        safety (deprecated).
     *
     *   - nonNullAsserts: insert non-null assertions no non-nullable method
     *        parameters (deprecated, was used to aid in null safety
     *        migrations).
     *
     *   - nativeNonNullAsserts: inject non-null assertions checks to validate
     *        that browser APIs are sound. This is helpful because browser APIs
     *        are generated from IDLs and cannot be proven to be correct
     *        statically.
     *
     *   - jsInteropNonNullAsserts: inject non-null assertiosn to check
     *        nullability of `package:js` JS-interop APIs. The new
     *        `dart:js_interop` always includes non-null assertions.
     *
     *   - dynamicModuleLoader: provide the implementation of dynamic module
     *        loading. Dynamic modules is an experimental feature.
     *        The DDC runtime delegates to the embedder how code for dynamic
     *        modules is downloaded. This entry in the configuration must be a
     *        function with the signature:
     *            `function(String, onLoad)`
     *        It accepts a `String` containing a Uri that denotes the module to
     *        be loaded. When the load completes, the loader must invoke
     *        `onLoad` and provide the module name of the dynamic module to it.
     *
     *        Note: eventually we may want to make the loader return a promise.
     *        We avoided that for now because it interfereres with our testing
     *        in d8.
     */
    dart_library.configure = function configure(appName, configuration) {
      let runtimeLibrary = dart_library.import("dart_sdk", appName).dart;
      if (!!configuration.weakNullSafetyErrors) {
        runtimeLibrary.weakNullSafetyErrors(configuration.weakNullSafetyErrors);
      }
      if (!!configuration.nonNullAsserts) {
        runtimeLibrary.nonNullAsserts(configuration.nonNullAsserts);
      }
      if (!!configuration.nativeNonNullAsserts) {
        runtimeLibrary.nativeNonNullAsserts(configuration.nativeNonNullAsserts);
      }
      if (!!configuration.jsInteropNonNullAsserts) {
        runtimeLibrary.jsInteropNonNullAsserts(
          configuration.jsInteropNonNullAsserts);
      }
      if (!!configuration.dynamicModuleLoader) {
        let loader = configuration.dynamicModuleLoader;
        runtimeLibrary.setDynamicModuleLoader(loader, (moduleName) => {
          //  As mentioned in the docs above, loader will not invoke the
          //  entrypoint, but just return the moduleName to find where to call
          //  it.  By using the module name, we don't need to expose the
          //  `import` as part of the embedding API.
          //  In the future module system, this will change to a library name,
          //  rather than a module name.
          return import_(moduleName, appName).__dynamic_module_entrypoint__();
        });
      }
    };
  })(dart_library);
}

// Initialize the DDC module loader.
//
// Scripts are JS objects with the following structure:
//   {"src": "path/to/script.js", "id": "lookup_id_for_script"}
(function () {
  let _currentDirectory = (function () {
    let _url = document.currentScript.src;
    let lastSlash = _url.lastIndexOf('/');
    if (lastSlash == -1) return _url;
    let currentDirectory = _url.substring(0, lastSlash + 1);
    return currentDirectory;
  })();

  let trimmedDirectory = _currentDirectory.endsWith("/") ?
    _currentDirectory.substring(0, _currentDirectory.length - 1)
    : _currentDirectory;

  if (!self.$dartLoader) {
    self.$dartLoader = {
      // Maps cosmetic (but stable) module names to their fully resolved URL.
      //
      // TODO(markzipan): Multi-app scripts can have module name conflicts.
      // This should ideally be separated per-app.
      moduleIdToUrl: new Map(),
      // Contains root directories below which scripts are resolved.
      rootDirectories: new Array(),
      // This mapping is required for proper translation of stack traces.
      urlToModuleId: new Map(),
      // The DDCLoader used for this app. Should not be used in multi-app
      // scenarios.
      loader: null,
      // The LoadConfiguration used for this app's DDCLoader. Should not be used
      // in multi-app scenarios.
      loadConfig: null
    };

    // Every distinct DDC app requires its own load configuration.
    self.$dartLoader.LoadConfiguration = class LoadConfiguration {
      constructor() {
        // Identifies the bootstrap script.
        // This should be set by bootstrappers for bootstrap-specific hooks.
        this.bootstrapScript = null;

        // True if the bootstrap script should be loaded on the this attempt.
        this.tryLoadBootstrapScript = false;

        // The underlying function that loads scripts.
        //
        // @param {function(!DDCLoader)}
        this.loadScriptFn = (_) => { };

        // The root for script URLs. Defaults to the root of this file.
        //
        // TODO(markzipan): Using the default is not safe in a multi-app scenario
        // due to apps clobbering state on dartLoader. Move this to the local
        // DDCLoader, which is unique per-app.
        this.root = trimmedDirectory;

        this.isWindows = false;

        // Optional event handlers.
        // Called when modules begin loading.
        this.onLoadStart = () => { };
        // Called when the app fails to load after retrying.
        this.onLoadError = () => { };
        // Called if loading the bootstrap script is successful.
        this.onBootstrapSuccess = () => { };
        // Called if the bootstrap script fails to load.
        this.onBootstrapError = () => { };

        this.maxRequestPoolSize = 1000;

        // Max retry to prevent from load failing scripts forever.
        this.maxAttempts = 6;
      }
    };
  }

  /**
   * Loads [jsFile] onto this instance's DDC app's page, then invokes
   * [onLoad].
   * @param {string} jsFile
   * @param {?function()} onLoad Callback after a successful load
   */
  self.$dartLoader.forceLoadScript = function (jsFile, onLoad) {
    // A head element won't be created for D8, so just load synchronously.
    if (self.dart_library.isD8) {
      self.load(jsFile);
      onLoad?.();
      return;
    }
    let script = self.dart_library.createScript();
    let policy = {
      createScriptURL: function (src) { return src; }
    };
    if (self.trustedTypes && self.trustedTypes.createPolicy) {
      policy = self.trustedTypes.createPolicy('dartDdcModuleUrl', policy);
    }
    script.setAttribute('src', policy.createScriptURL(jsFile));
    script.async = false;
    script.defer = true;
    script.onload = onLoad;
    self.document.head.appendChild(script);
  };

  self.$dartLoader.forceLoadModule = function (moduleName) {
    let modulePathScript = _currentDirectory + moduleName + '.js';
    self.$dartLoader.forceLoadScript(modulePathScript);
  };

  // Handles JS script downloads and evaluation for a DDC app.
  //
  // Every DDC application requires exactly one DDCLoader.
  self.$dartLoader.DDCLoader = class DDCLoader {
    constructor(loadConfig) {
      this.attemptCount = 0;

      this.loadConfig = loadConfig;

      // Scripts that await to be loaded.
      this.queue = new Array();

      // These refer to scripts already added to the document (as script tag).
      this.numToLoad = 0;
      this.numLoaded = 0;
      this.numFailed = 0;

      // Resets all the fields and makes a load attempt.
      this.nextAttempt = function () {
        if (this.attemptCount == 0) {
          this.loadConfig.onLoadStart();
        }
        this.attemptCount++;
        this.queue = new Array();
        this.numToLoad = 0;
        this.numLoaded = 0;
        this.numFailed = 0;

        this.loadConfig.loadScriptFn(this);
      };

      // The current 'intended' hot restart generation.
      //
      // 0-indexed and increases by 1 on every successful hot restart.
      // Unlike `hotRestartGeneration`, this is incremented when the intent to
      // perform a hot restart is established.
      // This is used to synchronize D8 timers and lookup files to load in
      // each generation for hot restart testing.
      this.intendedHotRestartGeneration = 0;
    }

    // True if we are still processing scripts from the script queue.
    // 'Processing' means the script is 1) currently being downloaded/parsed
    // or 2) the script failed to download and is being retried.
    scriptsActivelyBeingLoaded() {
      return this.numToLoad > this.numLoaded + this.numFailed;
    };

    // Joins path segments from the root directory to [script]'s path to get a
    // complete URL.
    getScriptUrl(script) {
      let pathSlash = this.loadConfig.isWindows ? "\\" : "/";
      // Get path segments for src
      let splitSrc = script.src.toString().split(pathSlash);
      let j = 0;
      // Count number of relative path segments
      while (splitSrc[j] == "..") {
        j++;
      }
      // Get path segments for root directory
      let splitDir = !this.loadConfig.root
        || this.loadConfig.root == pathSlash ? []
        : this.loadConfig.root.split(pathSlash);
      // Account for relative path from the root directory
      let splitPath = splitDir
        .slice(0, splitDir.length - j)
        .concat(splitSrc.slice(j));
      // Join path segments to get a complete path
      return splitPath.join(pathSlash);
    };

    // Adds [script] to the dartLoader's internals as if it had been loaded and
    // returns its fully resolved source path.
    //
    // Should be called when scripts are loaded on the page externally from
    // dartLoader's API.
    registerScript(script) {
      const src = this.getScriptUrl(script);
      // TODO(markzipan): moduleIdToUrl and urlToModuleId may conflict in
      // multi-app scenarios. Fix this by moving them into the DDCLoader.
      self.$dartLoader.moduleIdToUrl.set(script.id, src);
      self.$dartLoader.urlToModuleId.set(src, script.id);
      return src;
    };

    // Adds [scripts] to [queue] according to validation function [allowScriptFn].
    //
    // Scripts aren't loaded until loadEnqueuedModules is called.
    addScriptsToQueue(scripts, allowScriptFn) {
      for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];

        // Only load the bootstrap script after every other script has finished loading.
        if (script.src == this.loadConfig.bootstrapScript.src) {
          this.loadConfig.tryLoadBootstrapScript = true;
          continue;
        }
        // Skip loading already-loaded scripts.
        if (script.id == null || self.$dartLoader.moduleIdToUrl.has(script.id)) {
          continue;
        }

        // Register this script's resolved URL.
        let resolvedSrc = this.registerScript(script);

        // Deferred scripts should be registered but not added during bootstrap.
        if (self.$dartLoader.bootstrapModules !== void 0 &&
          !self.$dartLoader.bootstrapModules.has(script.id)) {
          continue;
        }

        if (!allowScriptFn || allowScriptFn(script)) {
          this.queue.push({ id: script.id, src: resolvedSrc });
        }
      }

      if (this.queue.length > 0) {
        console.info(
          `DDC is about to load ${this.queue.length}/${scripts.length} scripts with pool size = ${this.loadConfig.maxRequestPoolSize}`);
      }
    };

    // Creates a script element to be loaded into the provided container.
    createAndLoadScript(src, id, container, onError, onLoad) {
      let el = self.dart_library.createScript();
      el.src = policy.createScriptURL(src);
      el.async = false;
      el.defer = true;
      el.id = id;
      el.onerror = onError;
      el.onload = onLoad;
      container.appendChild(el);
    };

    // Retrieves scripts from the loader queue, with at most [maxRequests]
    // outgoing requests.
    //
    // TODO(markzipan): Rewrite this with a promise pool.
    loadMore(maxRequests) {
      let fragment = document.createDocumentFragment();
      let inflightRequests = 0;
      while (this.queue.length > 0 && inflightRequests++ < maxRequests) {
        const script = this.queue.shift();
        this.numToLoad++;
        this.createAndLoadScript(
          script.src.toString(),
          script.id,
          fragment,
          this.onError.bind(this),
          this.onLoad.bind(this)
        );
      }
      if (inflightRequests > 0) {
        document.head.appendChild(fragment);
      } else if (!this.scriptsActivelyBeingLoaded()) {
        this.loadBootstrapJs();
      }
    };

    loadOneMore() {
      if (this.queue.length > 0) {
        this.loadMore(1);
      }
    };

    // Loads modules when running with Chrome.
    loadEnqueuedModules() {
      this.loadMore(this.loadConfig.maxRequestPoolSize);
    };

    // Loads modules when running with d8.
    loadEnqueuedModulesForD8() {
      if (!self.dart_library.isD8) {
        throw Error("'loadEnqueuedModulesForD8' is only supported in D8.");
      }
      // Load all enqueued scripts sequentially.
      for (let i = 0; i < this.queue.length; i++) {
        const script = this.queue[i];
        self.load(script.src.toString());
      }
      this.queue.length = 0;
      // Load the bootstrapper script if it wasn't already loaded.
      if (this.loadConfig.tryLoadBootstrapScript) {
        const script = this.loadConfig.bootstrapScript;
        const src = this.registerScript(script);
        self.load(src);
        this.loadConfig.tryLoadBootstrapScript = false;
      }
      return;
    };

    // Loads just the bootstrap script.
    //
    // The bootstrapper is loaded only after all other scripts are loaded.
    loadBootstrapJs() {
      if (!this.loadConfig.tryLoadBootstrapScript) {
        return;
      }
      const script = this.loadConfig.bootstrapScript;
      const src = this.registerScript(script);
      this.createAndLoadScript(src, script.id, document.head, null, null);
      this.loadConfig.tryLoadBootstrapScript = false;
    };

    // Loads/retries compiled JS scripts.
    //
    // Should always be called after a script is loaded or errors.
    processAfterLoadOrErrorEvent() {
      if (this.scriptsActivelyBeingLoaded()) {
        if (this.numFailed == 0) {
          this.loadOneMore();
        } else if (this.attemptCount > this.maxAttempts) {
          // Some scripts have failed to load. Continue loading the rest.
          this.loadOneMore();
        } else {
          // Some scripts have failed to load, but we can still make another
          // load attempt. Wait for scheduled scripts to finish.
        }
        return;
      }

      // Retry failed scripts to a limit, then load the bootstrap script.
      if (this.numFailed == 0) {
        this.loadBootstrapJs();
        return;
      }
      // Reload whatever failed if maxAttempts is not reached.
      if (this.numFailed > 0) {
        if (this.attemptCount <= this.loadConfig.maxAttempts) {
          this.nextAttempt();
        } else {
          console.error(
            `Failed to load DDC scripts after ${this.loadConfig.maxAttempts} tries`);
          this.loadConfig.onLoadError();
          this.loadBootstrapJs();
        }
      }
    };

    onLoad(e) {
      this.numLoaded++;
      if (e.target.src == this.loadConfig.bootstrapScript.src) {
        this.loadConfig.onBootstrapSuccess();
      }
      this.processAfterLoadOrErrorEvent();
    };

    onError(e) {
      this.numFailed++;
      const target = e.target;
      self.$dartLoader.moduleIdToUrl.delete(target.id);
      self.$dartLoader.urlToModuleId.delete(target.src);
      self.deferred_loader.clearModule(target.id);

      if (target.src == this.loadConfig.bootstrapScript.src) {
        this.loadConfig.onBootstrapError();
      }
      this.processAfterLoadOrErrorEvent();
    };
  };

  let policy = {
    createScriptURL: function (src) { return src; }
  };

  if (self.trustedTypes && self.trustedTypes.createPolicy) {
    policy = self.trustedTypes.createPolicy("dartDdcModuleUrl", policy);
  }

  self.$dartLoader.loadScripts = function (scripts, loader) {
    loader.loadConfig.loadScriptFn = function (loader) {
      loader.addScriptsToQueue(scripts, null);
      loader.loadEnqueuedModules();
    };
    loader.nextAttempt();
  };
})();

if (!self.deferred_loader) {
  self.deferred_loader = {
    // Module IDs already loaded on the page (e.g., during bootstrap or after
    // loadLibrary is called).
    loadedModules: new Set(),
    // An import graph of all direct imports (not deferred).
    moduleGraph: new Map(),
    // Maps module IDs to their resolved urls.
    moduleToUrl: new Map(),
    // Module IDs mapped to their resolved or resolving promises.
    moduleToPromise: new Map(),
    // Deferred libraries on which 'loadLibrary' have already been called.
    // Load Ids are a composite of the URI of originating load's library and
    // the target library name.
    loadIds: new Set(),
  };

  /**
   * Must be called before 'main' to initialize the deferred loader.
   * @param {!Map<string, string>} moduleToUrlMapping
   * @param {!Map<string, !Array<string>>} moduleGraph non-deferred import graph
   * @param {!Array<string>} loadedModules moduled loaded during bootstrap
   */
  self.deferred_loader.initDeferredLoader = function (
    moduleToUrlMapping, moduleGraph, loadedModules) {
    self.deferred_loader.moduleToUrl = moduleToUrlMapping;
    self.deferred_loader.moduleGraph = moduleGraph;
    for (let i = 0; i < loadedModules.length; i++) {
      let module = loadedModules[i];
      self.deferred_loader.loadedModules.add(module);
      self.deferred_loader.moduleToPromise.set(module, Promise.resolve());
    }
  };

  /**
   * Returns all modules downstream of [moduleId] that are visible
   * (i.e., not deferred) and have not already been loaded.
   * @param {string} moduleId
   * @return {!Array<string>} module IDs that must be loaded with [moduleId]
   */
  let dependenciesToLoad = function (moduleId) {
    let stack = [moduleId];
    let seen = new Set();
    while (stack.length > 0) {
      let module = stack.pop();
      if (seen.has(module)) continue;
      seen.add(module);
      stack = stack.concat(self.deferred_loader.moduleGraph.get(module));
    }
    let dependencies = [];
    seen.forEach(module => {
      if (self.deferred_loader.loadedModules.has(module)) return;
      dependencies.push(module);
    });
    return dependencies;
  };

  /**
   * Loads [moduleUrl] onto this instance's DDC app's page, then invokes
   * [onLoad].
   * @param {string} moduleUrl
   * @param {function()} onLoad Callback after a successful load
   */
  let loadScript = function (moduleUrl, onLoad) {
    // A head element won't be created for D8, so just load synchronously.
    if (self.dart_library.isD8) {
      self.load(moduleUrl);
      onLoad();
      return;
    }
    let script = dart_library.createScript();
    let policy = {
      createScriptURL: function (src) {
        return src;
      }
    };
    if (self.trustedTypes && self.trustedTypes.createPolicy) {
      policy = self.trustedTypes.createPolicy('dartDdcModuleUrl', policy);
    }
    script.setAttribute('src', policy.createScriptURL(moduleUrl));
    script.async = false;
    script.defer = true;
    script.onload = onLoad;
    self.document.head.appendChild(script);
  };

  /**
   * Performs a deferred load, calling [onSuccess] or [onError] callbacks when
   * the deferred load completes or fails, respectively.
   * @param {string} loadId {library URI}:{resource name being loaded}
   * @param {string} targetModule moduleId of the resource requested by [loadId]
   * @param {function(function())} onSuccess callback after a successful load
   * @param {function(!Error)} onError callback after a failed load
   */
  self.deferred_loader.loadDeferred = function (
    loadId, targetModule, onSuccess, onError) {
    // loadLibrary had already been called, and its module has already been
    // loaded, so just complete the future.
    if (self.deferred_loader.loadIds.has(loadId)) {
      onSuccess();
      return;
    }

    // The module's been loaded, so mark this import as loaded and finish.
    if (self.deferred_loader.loadedModules.has(targetModule)) {
      self.deferred_loader.loadIds.add(loadId);
      onSuccess();
      return;
    }

    // The import's module has not been loaded, so load it and its dependencies
    // before completing the callback.
    let modulesToLoad = dependenciesToLoad(targetModule);
    Promise
      .all(modulesToLoad.map(module => {
        let url = self.deferred_loader.moduleToUrl.get(module);
        if (url === void 0) {
          console.log('Unable to find URL for module: ' + module);
          return;
        }
        let promise = self.deferred_loader.moduleToPromise.get(module);
        if (promise !== void 0) return promise;
        self.deferred_loader.moduleToPromise.set(
          module,
          new Promise((resolve) => loadScript(url, () => {
            self.deferred_loader.loadedModules.add(module);
            resolve();
          })));
        return self.deferred_loader.moduleToPromise.get(module);
      }))
      .then(() => {
        onSuccess(() => self.deferred_loader.loadIds.add(loadId));
      })
      .catch((error) => {
        onError(error.message);
      });
  };

  /**
   * Returns whether or not the module containing [loadId] has finished loading.
   * @param {string} loadId library URI concatenated with the resource being
   *     loaded
   * @return {boolean}
   */
  self.deferred_loader.isLoaded = function (loadId) {
    return self.deferred_loader.loadIds.has(loadId);
  };

  /**
   * Removes references to [moduleId] in the deferred loader.
   * @param {string} moduleId
   *
   * TODO(markzipan): Determine how deep we should clear moduleId's references.
   */
  self.deferred_loader.clearModule = function (moduleId) {
    self.deferred_loader.loadedModules.delete(moduleId);
    self.deferred_loader.moduleToUrl.delete(moduleId);
    self.deferred_loader.moduleToPromise.delete(moduleId);
  };

  /**
   * Clears state required for hot restart.
   */
  self.deferred_loader.hotRestart = function () {
    self.deferred_loader.loadIds = new Set();
  };
}

(function(dartDevEmbedder) {
  'use strict';

  if (dartDevEmbedder) {
    console.warn('Dart Development Embedder is already defined.');
    return;
  }

  /**
   * Manager for the state of libraries that orchestrates loading and reloading
   * of libraries.
   *
   * A library moves through multiple phases from the start of the application:
   *  - Definition Phase: A library defines itself by declaring it's existence
   *    to the library manager and provides an initialization function. At this
   *    point the library is known to exist but is not yet usable. It is an
   *    error to import a library that has not been defined.
   *  - Initialization Phase: The library's initialization function is evaluated
   *    to create a library object containing all of its members. After
   *    initialization a library is ready to be linked.
   *  - Link Phase: The link function (a library member synthesized by the
   *    compiler) is called to connect class hierarchies of the classes defined
   *    by the library. This can trigger the initialization and linking of
   *    dependency libraries. After a library has been linked it is ready for
   *    use in the application.
   */
  class LibraryManager {
    // A growable mapping of library names to their initialization functions.
    libraryInitializers = Object.create(null);

    // A growable mapping of library names to their initialized library objects.
    //
    // These are the result of calling a library's initialization function.
    libraries = Object.create(null);

    pendingHotReloadLibraryNames = null;
    pendingHotReloadFileUrls = null;
    pendingHotReloadLibraryInitializers = Object.create(null);

    pendingHotRestartLibraryInitializers = Object.create(null);

    // The name of the entrypoint module. Set when the application starts for
    // the first time and used during a hot restart.
    savedEntryPointLibraryName = null;

    // The current hot restart generation.
    //
    // 0-indexed and increases by 1 on every successful hot restart.
    // This value is read to determine the 'current' hot restart generation
    // in our hot restart tests. This closely tracks but is not the same as
    // `hotRestartIteration` in DDC's runtime.
    // TODO(nshahan): This value should become shared across the embedder and
    // the runtime.
    hotRestartGeneration = 0;

    hotRestartInProgress = false;

    // TODO(nshahan): Set to true at the start of the hot reload process.
    hotReloadInProgress = false;

    // The current hot reload generation.
    //
    // 0-indexed and increases by 1 on every successful hot reload.
    hotReloadGeneration = 0;

    // The name of the entrypoint module. Set when the application starts for
    // the first time and used during a hot restart.
    savedEntryPointLibraryName = null;
    savedDartSdkRuntimeOptions = null;

    // Whether we've initialized the necessary SDK libraries before any code or
    // debugging APIs can execute.
    //
    // This should be reset whenever we recreate `libraries`, like during a hot
    // restart.
    triggeredSDKLibrariesWithSideEffects = false;

    createEmptyLibrary() {
      return Object.create(null);
    }

    // See docs on `DartDevEmbedder.runMain`.
    defineLibrary(libraryName, initializer) {
      // TODO(nshahan): Make this test stronger and check for generations. A
      // library that is part of a pending hot reload could also be defined as
      // part of the previous generation.
      if (this.hotReloadInProgress) {
        if (this.pendingHotReloadLibraryNames.includes(libraryName)) {
          // If this is a library we're expecting to hot reload then collect the
          // initializer.
          this.pendingHotReloadLibraryInitializers[libraryName] = initializer;
        } else if (!(libraryName in this.libraryInitializers)) {
          // Otherwise if this is a new library (added via a new import), then
          // add the initializer to the base set of libraries.
          this.libraryInitializers[libraryName] = initializer;
        }
        // Otherwise this library is not expected to be hot reload so ignore it.
      } else if (libraryManager.hotRestartInProgress) {
        // TODO(srujzs): We should have a `pendingHotRestartLibraryNames` set
        // like we do with hot reload, but that requires a change to the
        // `hotRestart` API. This would prevent libraries that have different
        // names from the ones we expect to be compiled during a hot restart
        // from being accidentally treated as part of the hot restart.
        this.pendingHotRestartLibraryInitializers[libraryName] = initializer;
      } else if (libraryName in this.libraryInitializers) {
        throw 'Library ' + libraryName +
            ' was previously defined but DDC is not currently executing a hot ' +
            ' reload or a hot restart. Failed to define the library.';
      } else {
        this.libraryInitializers[libraryName] = initializer;
      }
    }

    /**
     * Initializes and links a library.
     *
     * @param {string} libraryName Name of the library to be initialized and
     *   linked.
     * @param {?function (Object?)} installFn A function to call to install the
     *   initialized library object into the context of an import. See
     *   `importLibrary` for more details.
     * @return {!Object} The library object ready for use by the application.
     */
    initializeAndLinkLibrary(libraryName, installFn) {
      if (!this.triggeredSDKLibrariesWithSideEffects) {
        this.triggerSDKLibrariesWithSideEffects();
      }
      let currentLibrary = this.libraries[libraryName];
      if (currentLibrary == null) {
        currentLibrary = this.createEmptyLibrary();
        // Run the initialization logic.
        let initializer = this.libraryInitializers[libraryName];
        if (initializer == null) {
          throw 'Library not defined: ' + libraryName + '. Failed to initialize.';
        }
        initializer(currentLibrary);
        // We make the library available in the map before linking to break out
        // of cycles in library dependencies.
        // Invariant: during linking a library dependency can be read in a state
        // where it is initialized but may not be linked.
        this.libraries[libraryName] = currentLibrary;
        // Link the library. This action will trigger the initialization and
        // linking of dependency libraries as needed.
        currentLibrary[linkSymbol]();
      }
      if (installFn != null) {
        installFn(currentLibrary);
      }
      // Invariant: at this point the library and all of its recursive
      // dependencies are fully initialized and linked.
      return currentLibrary;
    }

    // See docs on `DartDevEmbedder.runMain`.
    importLibrary(libraryName, installFn) {
      let currentLibrary = this.libraries[libraryName];
      if (currentLibrary != null) {
        // Library has already been initialized and linked.
        return currentLibrary;
      }
      // If there is no install function, the library must be initialized and
      // linked immediately.
      if (installFn == null) {
        // TODO(nshahan): Should we make this a separate API only used for the
        // SDK imports?
        return this.initializeAndLinkLibrary(libraryName);
      }

      // Library initialization is lazy and only performed on the first access.
      return new Proxy(Object.create(null), {
        get: function(_, property) {
          let library =
              libraryManager.initializeAndLinkLibrary(libraryName, installFn);
          return library[property];
        },
        set: function(_, property, value) {
          let library =
              libraryManager.initializeAndLinkLibrary(libraryName, installFn);
          library[property] = value;
          return true;
        },
      });
    }

    /**
     * Forces the SDK libraries with side effects on the JavaScript side to be
     * initialized and linked.
     *
     * These side effects could be required for correct Dart semantics
     * (ex: dart:_interceptors) or observable from a carefully crafted user
     * program (ex: dart:html). In either case, the dependencies on the side
     * effects are not expressed through a Dart import so the libraries need
     * to be loaded manually before the user program starts running or before
     * any debugging API is used.
     */
    triggerSDKLibrariesWithSideEffects() {
      this.triggeredSDKLibrariesWithSideEffects = true;
      this.initializeAndLinkLibrary('dart:_runtime');
      this.initializeAndLinkLibrary('dart:_interceptors');
      this.initializeAndLinkLibrary('dart:_native_typed_data');
      this.initializeAndLinkLibrary('dart:html');
      this.initializeAndLinkLibrary('dart:indexed_db');
      this.initializeAndLinkLibrary('dart:svg');
      this.initializeAndLinkLibrary('dart:web_audio');
      this.initializeAndLinkLibrary('dart:web_gl');
    }

    // Runs the 'main' method on `entryPointLibrary` while attaching
    // `capturedMainHandler` and `mainErrorCallback`.
    _runMain(entryPointLibrary, args = []) {
      // TODO(35113): Provide the ability to pass arguments in a type safe way.
      let runMainAndHandleErrors = () => {
        try {
          let mainValue = entryPointLibrary.main(args);
          // Attach the error callback to main's future if it's async.
          if (dartDevEmbedderConfig.mainErrorCallback != null &&
              mainValue != null && mainValue.catchError != null) {
            mainValue.catchError((e) => {
              dartDevEmbedderConfig.mainErrorCallback();
              throw e;
            });
          }
        } catch (e) {
          // Invoke the error callback if main is sync. This doesn't conflict
          // with the rethrow in the async path since DDC catches async errors
          // in a separate code path.
          if (dartDevEmbedderConfig.mainErrorCallback != null) {
            dartDevEmbedderConfig.mainErrorCallback();
          }
          throw e;
        }
      };
      if (dartDevEmbedderConfig.capturedMainHandler) {
        dartDevEmbedderConfig.capturedMainHandler(runMainAndHandleErrors);
      } else {
        runMainAndHandleErrors();
      }
    }

    // See docs on `DartDevEmbedder.runMain`.
    runMain(entryPointLibraryName, dartSdkRuntimeOptions) {
      this.setDartSDKRuntimeOptions(dartSdkRuntimeOptions);
      console.log(
          'Starting application from main method in: ' + entryPointLibraryName +
          '.');
      let entryPointLibrary =
          this.initializeAndLinkLibrary(entryPointLibraryName);
      this.savedEntryPointLibraryName = entryPointLibraryName;
      this.savedDartSdkRuntimeOptions = dartSdkRuntimeOptions;
      this._runMain(entryPointLibrary);
    }

    setDartSDKRuntimeOptions(options) {
      let dartRuntimeLibrary = this.importLibrary('dart:_runtime');
      // TODO(nshahan) Use a single method in the Dart SDK to set all options?
      // Or assign the single JS object and read it from the SDK?
      if (options.weakNullSafetyErrors != null) {
        dartRuntimeLibrary.weakNullSafetyErrors(options.weakNullSafetyErrors);
      }
      if (options.nonNullAsserts != null) {
        dartRuntimeLibrary.nonNullAsserts(options.nonNullAsserts);
      }
      if (options.nativeNonNullAsserts != null) {
        dartRuntimeLibrary.nativeNonNullAsserts(options.nativeNonNullAsserts);
      }
      if (options.jsInteropNonNullAsserts != null) {
        dartRuntimeLibrary.jsInteropNonNullAsserts(
            options.jsInteropNonNullAsserts);
      }
    }

    /**
     * Begins a hot reload operation.
     *
     * @param {!Array<string>} filesToLoad The urls of the files that contain
     * the libraries to hot reload.
     * @param {!Array<string>} librariesToReload The names of the libraries to
     * hot reload.
     */
    async hotReloadStart(filesToLoad, librariesToReload) {
      // TODO(60842): When deferred loading is implemented, block hot reloads
      //   until all active deferred loads have completed.
      this.hotReloadInProgress = true;
      this.pendingHotReloadFileUrls ??= filesToLoad;
      this.pendingHotReloadLibraryNames ??= librariesToReload;
      // Trigger download of the new library versions.
      let reloadFilePromises = [];
      for (let file of this.pendingHotReloadFileUrls) {
        reloadFilePromises.push(new Promise((resolve) => {
          self.$dartLoader.forceLoadScript(file, resolve);
        }));
      }
      await Promise.all(reloadFilePromises).then((_) => {
        if (dartDevEmbedderConfig.capturedHotReloadEndHandler != null) {
          // Let the app decide when to update the libraries.
          dartDevEmbedderConfig.capturedHotReloadEndHandler(() => {
            this.hotReloadEnd();
          });
        } else {
          this.hotReloadEnd();
        }
      });
    }

    /**
     * Completes a hot reload operation.
     *
     * This method runs synchronously to guarantee that all libraries
     * are in a consistent state before yielding control back to the
     * application.
     */
    hotReloadEnd() {
      // Clear RTI subtype caches before initializing libraries.
      // These needs to be done before hot reload completes (and any new
      // libraries initialize) in case subtype hierarchies updated.
      let dartRtiLibrary = this.importLibrary('dart:_rti');
      dartRtiLibrary.resetRtiSubtypeCaches();

      // On a hot reload, we reuse the existing library objects to ensure all
      // references remain valid and continue to be unique. We track in
      // `previouslyLoaded` which libraries already exist in the system, so we
      // can properly initialize and link them with the new version of the code.
      let previouslyLoaded = Object.create(null);
      for (let name of this.pendingHotReloadLibraryNames) {
        previouslyLoaded[name] = (this.libraries[name] != null);
      }

      // All initializers are updated, but only libraries that were previously
      // loaded need to be reinitialized.
      for (let name of this.pendingHotReloadLibraryNames) {
        let initializer = this.pendingHotReloadLibraryInitializers[name];
        this.libraryInitializers[name] = initializer;
        if (previouslyLoaded[name]) {
          initializer(this.libraries[name]);
        }
      }

      // Then we link the existing libraries. Note this may trigger initializing
      // and linking new library dependencies that were not present before and
      // requires for all library initializers to be up to date.
      for (let name in this.pendingHotReloadLibraryInitializers) {
        if (previouslyLoaded[name]) {
          this.libraries[name][linkSymbol]();
        }
      }
      // Cleanup.
      this.pendingHotReloadLibraryInitializers = Object.create(null);
      this.pendingHotReloadLibraryNames = null;
      this.pendingHotReloadFileUrls = null;
      this.hotReloadInProgress = false;
      this.hotReloadGeneration += 1;
    }

    // See docs on `DartDevEmbedder.hotRestartBegin`.
    async hotRestartBegin(filesToRequest) {
      if (!this.savedEntryPointLibraryName) {
        throw 'Error: Hot restart requested before application started.';
      }
      this.hotRestartInProgress = true;
      let reloadedFiles = await self.$dartReloadModifiedModules(
          filesToRequest, this.savedEntryPointLibraryName);
      return reloadedFiles;
    }

    // See docs on `DartDevEmbedder.hotRestartEnd`.
    hotRestartEnd() {
      if (!this.hotRestartInProgress) {
        throw 'Error: Hot restart end called without a corresponding start.';
      }
      // Clear all libraries.
      this.libraries = Object.create(null);
      this.triggeredSDKLibrariesWithSideEffects = false;
      this.setDartSDKRuntimeOptions(this.savedDartSdkRuntimeOptions);
      // Update initializers. They'll be invoked later at some point after we
      // call main.
      for (let name in this.pendingHotRestartLibraryInitializers) {
        let initializer = this.pendingHotRestartLibraryInitializers[name];
        this.libraryInitializers[name] = initializer;
      }
      let entryPointLibrary =
          this.initializeAndLinkLibrary(this.savedEntryPointLibraryName);
      // TODO(nshahan): Start sharing a single source of truth for the restart
      // generation between the dart:_runtime and this module system.
      this.hotRestartGeneration += 1;
      console.log(
          'Hot restarting application from main method in: ' +
          this.savedEntryPointLibraryName +
          ' (generation: ' + this.hotRestartGeneration + ').');
      // Cleanup.
      this.hotRestartInProgress = false;
      this.pendingHotRestartLibraryInitializers = Object.create(null);

      this._runMain(entryPointLibrary);
    }


    /**
     * Completes a hot restart operation.
     *
     * @deprecated Use `hotRestartBegin` and `hotRestartEnd` instead.
     */
    hotRestart() {
      if (!this.savedEntryPointLibraryName) {
        throw 'Error: Hot restart requested before application started.';
      }
      // Clear all libraries.
      this.libraries = Object.create(null);
      this.triggeredSDKLibrariesWithSideEffects = false;
      this.setDartSDKRuntimeOptions(this.savedDartSdkRuntimeOptions);
      // Update initializers. They'll be invoked later at some point after we
      // call main.
      for (let name in this.pendingHotRestartLibraryInitializers) {
        let initializer = this.pendingHotRestartLibraryInitializers[name];
        this.libraryInitializers[name] = initializer;
      }
      let entryPointLibrary =
          this.initializeAndLinkLibrary(this.savedEntryPointLibraryName);
      // TODO(nshahan): Start sharing a single source of truth for the restart
      // generation between the dart:_runtime and this module system.
      this.hotRestartGeneration += 1;
      console.log(
          'Hot restarting application from main method in: ' +
          this.savedEntryPointLibraryName +
          ' (generation: ' + this.hotRestartGeneration + ').');
      // Cleanup.
      this.hotRestartInProgress = false;
      this.pendingHotRestartLibraryInitializers = Object.create(null);

      this._runMain(entryPointLibrary);
    }
  }

  // This is closed-upon to avoid exposing it through the `dartDevEmbedder`.
  const libraryManager = new LibraryManager();

  function dartDebuggerLibrary() {
    return libraryManager.initializeAndLinkLibrary('dart:_debugger');
  }

  function dartDeveloperLibrary() {
    return libraryManager.initializeAndLinkLibrary('dart:developer');
  }

  function dartRuntimeLibrary() {
    return libraryManager.initializeAndLinkLibrary('dart:_runtime');
  }

  // Map from Dart file path to its stringified source map. It should only be
  // set or accessed through the `Debugger`.
  const sourceMaps = {};

  /**
   * Common debugging APIs that may be useful for metadata, invocations,
   * developer extensions, bootstrapping, and more.
   */
  // TODO(56966): A number of APIs in this class consume and return Dart
  // objects, nested or otherwise. We should replace them with some kind of
  // metadata instead so users don't accidentally rely on the object's
  // representation. For now, we warn users to not do so in the APIs below.
  class Debugger {
    /**
     * Returns a JavaScript array of all class names in a Dart library.
     *
     * @param {string} libraryUri URI of the Dart library.
     * @return {!Array<string>} Array containing the class names in the library.
     */
    getClassesInLibrary(libraryUri) {
      libraryManager.initializeAndLinkLibrary(libraryUri);
      return dartRuntimeLibrary().getLibraryMetadata(
          libraryUri, libraryManager.libraries);
    }

    /**
     * Returns a JavaScript object containing metadata of a class in a given
     * Dart library.
     *
     * The object will be formatted as such:
     * ```
     * {
     *   'className': <dart class name>,
     *   'superClassName': <super class name, if any>
     *   'superClassLibraryId': <super class library ID, if any>
     *   'fields': {
     *     <name>: {
     *       'isConst': <true if the member is const>,
     *       'isFinal': <true if the member is final>,
     *       'isStatic':  <true if the member is final>,
     *       'className': <class name for a field type>,
     *       'classLibraryId': <library id for a field type>,
     *     }
     *   },
     *   'methods': {
     *     <name>: {
     *       'isConst': <true if the member is const>,
     *       'isStatic':  <true if the member is static>,
     *       'isSetter" <true if the member is a setter>,
     *       'isGetter" <true if the member is a getter>,
     *     }
     *   },
     * }
     * ```
     *
     * @param {string} libraryUri URI of the Dart library that the class is in.
     * @param {string} name Name of the Dart class.
     * @param {?Object} objectInstance Optional instance of the Dart class that's
     * needed to determine the type of any generic members.
     * @return {?Object<string, !any>} Object containing the metadata in the
     * above format.
     */
    getClassMetadata(libraryUri, name, objectInstance) {
      libraryManager.initializeAndLinkLibrary(libraryUri);
      return dartRuntimeLibrary().getClassMetadata(
          libraryUri, name, objectInstance, libraryManager.libraries);
    }

    /**
     * Returns a JavaScript object containing metadata about a Dart value.
     *
     * The object will be formatted as such:
     * ```
     * {
     *   'className': <dart class name>,
     *   'libraryId': <library URI for the object type>,
     *   'runtimeKind': <kind of the object for display purposes>,
     *   'length': <length of the object if applicable>,
     *   'typeName': <name of the type represented if object is a Type>,
     * }
     * ```
     *
     * @param {!Object} value Dart value for which metadata is computed.
     * @return {!Object<string, !any>} Object containing the metadata in the
     * above format.
     */
    getObjectMetadata(value) {
      return dartRuntimeLibrary().getObjectMetadata(value);
    }

    /**
     * Returns the name of the given function. If it's bound to an object of
     * class `C`, returns `C.<name>` instead.
     *
     * @param {!Object} fun Dart function for which the name is returned.
     * @return {string} Name of the given function in the above format.
     */
    getFunctionName(fun) {
      return dartRuntimeLibrary().getFunctionMetadata(fun);
    }

    /**
     * Returns an array of all the field names in the Dart object.
     *
     * @param {!Object} object Dart object whose field names are collected.
     * @return {!Array<string>} Array of field names.
     */
    getObjectFieldNames(object) {
      return dartRuntimeLibrary().getObjectFieldNames(object);
    }

    /**
     * If given a Dart `Set`, `List`, or `Map`, returns a sub-range array of at
     * most the given number of elements starting at the given offset. If given
     * any other Dart value, returns the original value. Any Dart values
     * returned from this API should be treated as opaque pointers and should
     * not be interacted with.
     *
     * @param {!Object} object Dart object for which the sub-range is computed.
     * @param {number} offset Integer index at which the sub-range should start.
     * @param {number} count Integer number of values in the sub-range.
     * @return {!any} Either the sub-range or the original object.
     */
    getSubRange(object, offset, count) {
      return dartRuntimeLibrary().getSubRange(object, offset, count);
    }

    /**
     * Returns a JavaScript object containing the entries for a given Dart `Map`
     * that will be formatted as:
     *
     * ```
     * {
     *   'keys': [ <key>, ...],
     *   'values': [ <value>, ...],
     * }
     * ```
     *
     * Any Dart values returned from this API should be treated as opaque
     * pointers and should not be interacted with.
     *
     * @param {!Object} map Dart `Map` whose entries will be copied.
     * @return {!Object<string, !Array>} Object containing the entries in
     * the above format.
     */
    getMapElements(map) {
      return dartRuntimeLibrary().getMapElements(map);
    }

    /**
     * Returns a JavaScript object containing the entries for a given Dart `Set`
     * that will be formatted as:
     *
     * ```
     * {
     *   'entries': [ <entry>, ...],
     * }
     * ```
     *
     * Any Dart values returned from this API should be treated as opaque
     * pointers and should not be interacted with.
     *
     * @param {!Object} set Dart `Set` whose entries will be copied.
     * @return {!Object<string, !Array>} Object containing the entries in the
     * above format.
     */
    getSetElements(set) {
      return dartRuntimeLibrary().getSetElements(set);
    }

    /**
     * Returns a JavaScript object containing metadata for a given Dart `Record`
     * that will be formatted as:
     *
     * ```
     * {
     *   'positionalCount': <number of positional elements>,
     *   'named': [ <name>, ...],
     *   'values': [ <positional value>, ..., <named value>, ... ],
     * }
     * ```
     *
     * Any Dart values returned from this API should be treated as opaque
     * pointers and should not be interacted with.
     *
     * @param {!Object} record Dart `Record` whose metadata will be computed.
     * @return {!Object<string, ?any>} Object containing the metadata in the
     * above format.
     */
    getRecordFields(record) {
      return dartRuntimeLibrary().getRecordFields(record);
    }

    /**
     * Returns a JavaScript object containing metadata for a given Dart
     * `Record`'s runtime type that will be formatted as:
     *
     * ```
     * {
     *   'positionalCount': <number of positional types>,
     *   'named': [ <name>, ...],
     *   'types': [ <positional type>, ..., <named type>, ... ],
     * }
     * ```
     *
     * Any Dart values returned from this API should be treated as opaque
     * pointers and should not be interacted with.
     *
     * @param {!Object} recordType Dart `Type` of a `Record` whose metadata will
     * be computed.
     * @return {!Object<string, ?any>} Object containing the metadata in the
     * above format.
     */
    getRecordTypeFields(recordType) {
      return dartRuntimeLibrary().getRecordTypeFields(recordType);
    }

    /**
     * Given a Dart instance, calls the method with the given name in that
     * instance and returns the result.
     *
     * Any Dart values returned from this API should be treated as opaque
     * pointers and should not be interacted with.
     *
     * @param {?Object} instance Dart instance whose method will be called.
     * @param {string} name Name of the method.
     * @param {!Array} args Array of arguments passed to the method.
     * @return {?any} Result of calling the method.
     */
    callInstanceMethod(instance, name, args) {
      return dartRuntimeLibrary().dsendRepl(instance, name, args);
    }

    /**
     * Given a Dart library URI, calls the method with the given name in that
     * library and returns the result.
     *
     * Any Dart values returned from this API should be treated as opaque
     * pointers and should not be interacted with.
     *
     * @param {string} libraryUri Dart library URI in which the method exists.
     * @param {string} name Name of the method.
     * @param {!Array} args Array of arguments passed to the method.
     * @return {?any} Result of calling the method.
     */
    callLibraryMethod(libraryUri, name, args) {
      let library = libraryManager.initializeAndLinkLibrary(libraryUri);
      return library[name].apply(library, args);
    }

    /**
     * Register the DDC Chrome DevTools custom formatter into the global
     * `devtoolsFormatters` property.
     */
    registerDevtoolsFormatter() {
      dartDebuggerLibrary().registerDevtoolsFormatter();
    }

    /**
     * Invoke a registered extension with the given name and encoded map.
     *
     * @param {string} methodName The name of the registered extension.
     * @param {string} encodedJson The encoded string map that will be passed as
     * a parameter to the invoked method.
     * @return {!Promise} Promise that will await the invocation of the
     * extension.
     */
    invokeExtension(methodName, encodedJson) {
      return dartDeveloperLibrary().invokeExtension(methodName, encodedJson);
    }

    /**
     * Returns a JavaScript array containing the names of the extensions
     * registered in `dart:developer`.
     *
     * @return {!Array<string>} Array containing the extension names.
     */
    get extensionNames() {
      return dartDeveloperLibrary()._extensions.keys.toList();
    }

    /**
     * Returns a Dart stack trace string given an error caught in JS. If the
     * error is a Dart error or JS `Error`, we use the built-in stack. If the
     * error is neither, we try to construct a stack trace if possible.
     *
     * @param {?any} error The error for which a stack trace will be produced.
     * @return {string} The stringified stack trace.
     */
    stackTrace(error) {
      return dartRuntimeLibrary().stackTrace(error).toString();
    }

    /**
     * Entrypoint for DDC-generated code to set a source map for a given
     * library bundle name.
     *
     * @param {string} libraryBundleName The name of a compiled Dart library
     *     bundle.
     * @param {string} sourceMap The stringified source map.
     */
    // TODO(srujzs): If users shouldn't ever need to use this, can we make this
    // not accessible for them?
    setSourceMap(libraryBundleName, sourceMap) {
      sourceMaps[libraryBundleName] = sourceMap;
    }

    /**
     * Returns the source map path for a given library bundle name, if one was
     * registered.
     *
     * @param {string} libraryBundleName The name of a compiled Dart library
     *     bundle.
     * @return {?string} The stringified source map if it was registered.
     */
    getSourceMap(libraryBundleName) {
      return sourceMaps[libraryBundleName];
    }
  }

  const debugger_ = new Debugger();

  /**
   * Holds public configurations for the `DartDevEmbedder`.
   *  These properties may be modified during the runtime of the app.
   */
  class DartDevEmbedderConfiguration {
    /**
     * An optional handler that acts as a wrapper around the invocation of the
     * Dart program's 'main' method. Passed an opaque function as an argument
     * that invokes 'main' when called.
     * @type {?function(function())}
     */
    // TODO(nshahan): Remove this once the migration is complete.
    capturedMainHandler = null;

    /**
     * An optional callback that is invoked when 'main' throws.
     * @type {?function()}
     */
    mainErrorCallback = null;

    /**
     * An optional handler that acts as a wrapper around the push of the hot
     * reloaded libraries into the Dart runtime which completes the hot reload.
     * Passed an opaque function as an argument that pushes the libraries that
     * were previously loaded into the page during a call to
     * `DartDevEmbedder.hotReload` when called.
     * @type {?function(function())}
     */
    capturedHotReloadEndHandler = null;
  }

  const dartDevEmbedderConfig = new DartDevEmbedderConfiguration();

  /**
   * A symbol used to store the 'link' function on libraries.
   */
  const linkSymbol = Symbol('link');

  /**
   * The API for embedding a Dart application in the page at development time
   * that supports stateful hot reloading.
   */
  class DartDevEmbedder {
    /**
     * @return {!DartDevEmbedderConfiguration} The configururation object for
     * this `DartDevEmbedder`.
     */
    get config() {
      return dartDevEmbedderConfig;
    }

    /**
     * @return {!Symbol} The symbol used to store the 'link' function on
     * libraries.
     *
     * NOTE: This is intended to only be used by DDC generated code.
     */
    get linkSymbol() {
      return linkSymbol;
    }

    /**
     * Runs the Dart main method.
     *
     * Intended to be invoked by the bootstrapping code where the application is
     * being embedded.
     *
     * @param {string} entryPointLibraryName The name of the library that
     * contains an entry point main method.
     * @param {!Object<string, boolean>} dartSdkRuntimeOptions An options bag for
     * setting the runtime options in the Dart SDK.
     */
    runMain(entryPointLibraryName, dartSdkRuntimeOptions) {
      libraryManager.runMain(entryPointLibraryName, dartSdkRuntimeOptions);
    }

    /**
     * Declares the existence of a library identified by the `libraryName` and
     * initialized by `initFn`.
     *
     * Should only be called from DDC compiled code.
     *
     * The initialization function may be called lazily when needed.
     *
     * @param {string} libraryName Name for referencing the library being
     *   defined.
     * @param {function (!Object): !Object} initializer Function called to
     *   initialize the library. This callback takes a library object and
     *   installs the library members into it.
     */
    defineLibrary(libraryName, initializer) {
      libraryManager.defineLibrary(libraryName, initializer);
    }

    /**
     * Imports a library to make it available in the context of the import.
     *
     * Should only be called from DDC compiled code.
     *
     * The imported library may be initialized and linked lazily at the time of
     * the first member access.
     *
     * @param {string} libraryName Name of the library to import.
     * @param {?function (!Object)} installFn A callback invoked with the library
     *  object after the library has been initialized and linked. This
     *  notification is used to improve performance. Callers may use this
     *  callback to replace the proxy object with the real library object and,
     *  in doing so, remove the overhead of jumping through an indirect proxy on
     *  every property access.
     * @return {!Object} A library object or a proxy to a library object.
     */
    importLibrary(libraryName, installFn) {
      return libraryManager.importLibrary(libraryName, installFn);
    }

    /**
     * DDC's entrypoint for triggering a hot reload.
     *
     * Previous generations may continue to run until all specified files
     * have been loaded and initialized.
     *
     * @param {!Array<string>} filesToLoad The urls of the files that contain
     * the libraries to hot reload.
     * @param {!Array<string>} librariesToReload The names of the libraries to
     * hot reload.
     */
    async hotReload(filesToLoad, librariesToReload) {
      await libraryManager.hotReloadStart(filesToLoad, librariesToReload);
    }

    /**
     * Immediately triggers the start of a hot restart of the application.
     *
     * Assumes that a function named `$dartReloadModifiedModules` is available
     * in the global scope and relies on it to actually request the files
     * that are being reloaded and add them to the document.
     *
     * @param {!Array<!Object>} filesToRequest The descriptor Objects
     *     describing the JavaScript files that could be part of this hot
     *     restart. This must include all the files that changed and need
     *     to be reloaded on the page.
     *
     *     Each descriptor Object must have the following properties:
     *     - src: The url of the Javascript file to request.
     *     - id: The unique and stable identifier for this file, typically
     *       the "module name" is used.
     *
     *     Additional properties may be present and will simply be passed
     *     through to the `$dartReloadModifiedModules` function.
     *
     * @return {!Promise<!Array<!Object>>} Descriptor Objects for the
     *     JavaScript files that were actually requested by
     *     `$dartReloadModifiedModules`.
     *
     *     This is expected to be the same set of files described by
     *     `filesToRequest` or a subset. Naming additional files could cause
     *     undefined behavior.
     *
     *     Note: when a Dart debugger is attached, the hot restart operation
     *     will block until a script parse event is received from Chrome
     *     DevTools for each of the JavaScript files described here.
     *
     *     Each descriptor Object returned from `$dartReloadModifiedModules`
     *     must contain the following properties:
     *     - src: The url of the Javascript file that was requested.
     *
     *     Additional properties may be present.
     */
    async hotRestartBegin(filesToRequest) {
      return await libraryManager.hotRestartBegin(filesToRequest);
    }

    /**
     * Finishes the hot restart operation that must have been previously
     * started by [hotRestartBegin] losing all application state and running
     * the main method again.
     */
    hotRestartEnd() {
      libraryManager.hotRestartEnd();
    }


    /**
     * Immediately triggers a hot restart of the application losing all state
     * and running the main method again.
     *
     * @deprecated Use `hotRestartBegin` and `hotRestartEnd` instead.
     */
    async hotRestart() {
      libraryManager.hotRestartInProgress = true;
      await self.$dartReloadModifiedModules(
          libraryManager.savedEntryPointLibraryName, () => {
            libraryManager.hotRestart();
          });
    }


    /**
     * @return {number} The current hot reload generation of the running
     * application.
     */
    get hotReloadGeneration() {
      return libraryManager.hotReloadGeneration;
    }

    /**
     * @return {number} The current hot restart generation of the running
     *  application.
     */
    get hotRestartGeneration() {
      return libraryManager.hotRestartGeneration;
    }

    /**
     * @return {!Debugger} Common debugging APIs that may be useful for metadata,
     * invocations, developer extensions, bootstrapping, and more.
     */
    get debugger() {
      return debugger_;
    }
  }

  self.dartDevEmbedder = new DartDevEmbedder();
})(self.dartDevEmbedder);

(function dartProgram(){function copyProperties(a,b){var s=Object.keys(a)
for(var r=0;r<s.length;r++){var q=s[r]
b[q]=a[q]}}function mixinPropertiesHard(a,b){var s=Object.keys(a)
for(var r=0;r<s.length;r++){var q=s[r]
if(!b.hasOwnProperty(q)){b[q]=a[q]}}}function mixinPropertiesEasy(a,b){Object.assign(b,a)}var z=function(){var s=function(){}
s.prototype={p:{}}
var r=new s()
if(!(Object.getPrototypeOf(r)&&Object.getPrototypeOf(r).p===s.prototype.p))return false
try{if(typeof navigator!="undefined"&&typeof navigator.userAgent=="string"&&navigator.userAgent.indexOf("Chrome/")>=0)return true
if(typeof version=="function"&&version.length==0){var q=version()
if(/^\d+\.\d+\.\d+\.\d+$/.test(q))return true}}catch(p){}return false}()
function inherit(a,b){a.prototype.constructor=a
a.prototype["$i"+a.name]=a
if(b!=null){if(z){Object.setPrototypeOf(a.prototype,b.prototype)
return}var s=Object.create(b.prototype)
copyProperties(a.prototype,s)
a.prototype=s}}function inheritMany(a,b){for(var s=0;s<b.length;s++){inherit(b[s],a)}}function mixinEasy(a,b){mixinPropertiesEasy(b.prototype,a.prototype)
a.prototype.constructor=a}function mixinHard(a,b){mixinPropertiesHard(b.prototype,a.prototype)
a.prototype.constructor=a}function lazy(a,b,c,d){var s=a
a[b]=s
a[c]=function(){if(a[b]===s){a[b]=d()}a[c]=function(){return this[b]}
return a[b]}}function lazyFinal(a,b,c,d){var s=a
a[b]=s
a[c]=function(){if(a[b]===s){var r=d()
if(a[b]!==s){A.eE(b)}a[b]=r}var q=a[b]
a[c]=function(){return q}
return q}}function makeConstList(a,b){if(b!=null)A.f(a,b)
a.$flags=7
return a}function convertToFastObject(a){function t(){}t.prototype=a
new t()
return a}function convertAllToFastObject(a){for(var s=0;s<a.length;++s){convertToFastObject(a[s])}}var y=0
function instanceTearOffGetter(a,b){var s=null
return a?function(c){if(s===null)s=A.f6(b)
return new s(c,this)}:function(){if(s===null)s=A.f6(b)
return new s(this,null)}}function staticTearOffGetter(a){var s=null
return function(){if(s===null)s=A.f6(a).prototype
return s}}var x=0
function tearOffParameters(a,b,c,d,e,f,g,h,i,j){if(typeof h=="number"){h+=x}return{co:a,iS:b,iI:c,rC:d,dV:e,cs:f,fs:g,fT:h,aI:i||0,nDA:j}}function installStaticTearOff(a,b,c,d,e,f,g,h){var s=tearOffParameters(a,true,false,c,d,e,f,g,h,false)
var r=staticTearOffGetter(s)
a[b]=r}function installInstanceTearOff(a,b,c,d,e,f,g,h,i,j){c=!!c
var s=tearOffParameters(a,false,c,d,e,f,g,h,i,!!j)
var r=instanceTearOffGetter(c,s)
a[b]=r}function setOrUpdateInterceptorsByTag(a){var s=v.interceptorsByTag
if(!s){v.interceptorsByTag=a
return}copyProperties(a,s)}function setOrUpdateLeafTags(a){var s=v.leafTags
if(!s){v.leafTags=a
return}copyProperties(a,s)}function updateTypes(a){var s=v.types
var r=s.length
s.push.apply(s,a)
return r}function updateHolder(a,b){copyProperties(b,a)
return a}var hunkHelpers=function(){var s=function(a,b,c,d,e){return function(f,g,h,i){return installInstanceTearOff(f,g,a,b,c,d,[h],i,e,false)}},r=function(a,b,c,d){return function(e,f,g,h){return installStaticTearOff(e,f,a,b,c,[g],h,d)}}
return{inherit:inherit,inheritMany:inheritMany,mixin:mixinEasy,mixinHard:mixinHard,installStaticTearOff:installStaticTearOff,installInstanceTearOff:installInstanceTearOff,_instance_0u:s(0,0,null,["$0"],0),_instance_1u:s(0,1,null,["$1"],0),_instance_2u:s(0,2,null,["$2"],0),_instance_0i:s(1,0,null,["$0"],0),_instance_1i:s(1,1,null,["$1"],0),_instance_2i:s(1,2,null,["$2"],0),_static_0:r(0,null,["$0"],0),_static_1:r(1,null,["$1"],0),_static_2:r(2,null,["$2"],0),makeConstList:makeConstList,lazy:lazy,lazyFinal:lazyFinal,updateHolder:updateHolder,convertToFastObject:convertToFastObject,updateTypes:updateTypes,setOrUpdateInterceptorsByTag:setOrUpdateInterceptorsByTag,setOrUpdateLeafTags:setOrUpdateLeafTags}}()
function initializeDeferredHunk(a){x=v.types.length
a(hunkHelpers,v,w,$)}var J={
fe(a,b,c,d){return{i:a,p:b,e:c,x:d}},
f9(a){var s,r,q,p,o,n="_$dart_js",m=a[v.dispatchPropertyName]
if(m==null)if($.fb==null){A.l_()
m=a[v.dispatchPropertyName]}if(m!=null){s=m.p
if(!1===s)return m.i
if(!0===s)return a
r=Object.getPrototypeOf(a)
if(s===r)return m.i
if(m.e===r)throw A.b(A.fT("Return interceptor for "+A.i(s(a,m))))}q=a.constructor
if(q==null)p=null
else{o=$.ea
if(o==null)o=$.ea=A.ev(n)
p=q[o]}if(p!=null)return p
p=A.l4(a)
if(p!=null)return p
if(typeof a=="function")return B.Q
s=Object.getPrototypeOf(a)
if(s==null)return B.v
if(s===Object.prototype)return B.v
if(typeof q=="function"){o=$.ea
if(o==null)o=$.ea=A.ev(n)
Object.defineProperty(q,o,{value:B.k,enumerable:false,writable:true,configurable:true})
return B.k}return B.k},
fy(a,b){if(a<0||a>4294967295)throw A.b(A.B(a,0,4294967295,"length",null))
return J.j4(new Array(a),b)},
fz(a,b){if(a<0)throw A.b(A.L("Length must be a non-negative integer: "+a))
return A.f(new Array(a),b.h("v<0>"))},
j4(a,b){var s=A.f(a,b.h("v<0>"))
s.$flags=1
return s},
fA(a){if(a<256)switch(a){case 9:case 10:case 11:case 12:case 13:case 32:case 133:case 160:return!0
default:return!1}switch(a){case 5760:case 8192:case 8193:case 8194:case 8195:case 8196:case 8197:case 8198:case 8199:case 8200:case 8201:case 8202:case 8232:case 8233:case 8239:case 8287:case 12288:case 65279:return!0
default:return!1}},
j5(a,b){var s,r
for(s=a.length;b<s;){r=a.charCodeAt(b)
if(r!==32&&r!==13&&!J.fA(r))break;++b}return b},
j6(a,b){var s,r,q
for(s=a.length;b>0;b=r){r=b-1
if(!(r<s))return A.a(a,r)
q=a.charCodeAt(r)
if(q!==32&&q!==13&&!J.fA(q))break}return b},
aS(a){if(typeof a=="number"){if(Math.floor(a)==a)return J.bu.prototype
return J.cw.prototype}if(typeof a=="string")return J.aH.prototype
if(a==null)return J.bv.prototype
if(typeof a=="boolean")return J.cv.prototype
if(Array.isArray(a))return J.v.prototype
if(typeof a!="object"){if(typeof a=="function")return J.ad.prototype
if(typeof a=="symbol")return J.by.prototype
if(typeof a=="bigint")return J.bw.prototype
return a}if(a instanceof A.r)return a
return J.f9(a)},
aT(a){if(typeof a=="string")return J.aH.prototype
if(a==null)return a
if(Array.isArray(a))return J.v.prototype
if(typeof a!="object"){if(typeof a=="function")return J.ad.prototype
if(typeof a=="symbol")return J.by.prototype
if(typeof a=="bigint")return J.bw.prototype
return a}if(a instanceof A.r)return a
return J.f9(a)},
bg(a){if(a==null)return a
if(Array.isArray(a))return J.v.prototype
if(typeof a!="object"){if(typeof a=="function")return J.ad.prototype
if(typeof a=="symbol")return J.by.prototype
if(typeof a=="bigint")return J.bw.prototype
return a}if(a instanceof A.r)return a
return J.f9(a)},
dq(a){if(typeof a=="string")return J.aH.prototype
if(a==null)return a
if(!(a instanceof A.r))return J.b3.prototype
return a},
as(a,b){if(a==null)return b==null
if(typeof a!="object")return b!=null&&a===b
return J.aS(a).K(a,b)},
iy(a,b){if(typeof b==="number")if(Array.isArray(a)||typeof a=="string"||A.l3(a,a[v.dispatchPropertyName]))if(b>>>0===b&&b<a.length)return a[b]
return J.aT(a).p(a,b)},
iz(a,b,c){return J.bg(a).v(a,b,c)},
eG(a,b){return J.dq(a).ap(a,b)},
iA(a,b,c){return J.dq(a).aq(a,b,c)},
iB(a,b){return J.bg(a).ar(a,b)},
iC(a,b){return J.dq(a).cb(a,b)},
iD(a,b){return J.aT(a).u(a,b)},
dr(a,b){return J.bg(a).F(a,b)},
aW(a){return J.aS(a).gD(a)},
ac(a){return J.bg(a).gt(a)},
a5(a){return J.aT(a).gl(a)},
iE(a){return J.aS(a).gG(a)},
iF(a,b,c){return J.dq(a).bz(a,b,c)},
ds(a,b){return J.bg(a).V(a,b)},
iG(a,b){return J.dq(a).q(a,b)},
fm(a,b){return J.bg(a).a4(a,b)},
iH(a){return J.bg(a).bE(a)},
bj(a){return J.aS(a).i(a)},
ct:function ct(){},
cv:function cv(){},
bv:function bv(){},
bx:function bx(){},
av:function av(){},
cR:function cR(){},
b3:function b3(){},
ad:function ad(){},
bw:function bw(){},
by:function by(){},
v:function v(a){this.$ti=a},
cu:function cu(){},
dK:function dK(a){this.$ti=a},
aE:function aE(a,b,c){var _=this
_.a=a
_.b=b
_.c=0
_.d=null
_.$ti=c},
cx:function cx(){},
bu:function bu(){},
cw:function cw(){},
aH:function aH(){}},A={eK:function eK(){},
dt(a,b,c){if(t.X.b(a))return new A.c_(a,b.h("@<0>").L(c).h("c_<1,2>"))
return new A.aF(a,b.h("@<0>").L(c).h("aF<1,2>"))},
j7(a){return new A.cB("Field '"+a+"' has been assigned during initialization.")},
ew(a){var s,r=a^48
if(r<=9)return r
s=a|32
if(97<=s&&s<=102)return s-87
return-1},
d2(a,b){a=a+b&536870911
a=a+((a&524287)<<10)&536870911
return a^a>>>6},
fO(a){a=a+((a&67108863)<<3)&536870911
a^=a>>>11
return a+((a&16383)<<15)&536870911},
f5(a,b,c){return a},
fd(a){var s,r
for(s=$.Z.length,r=0;r<s;++r)if(a===$.Z[r])return!0
return!1},
al(a,b,c,d){A.Q(b,"start")
if(c!=null){A.Q(c,"end")
if(b>c)A.a4(A.B(b,0,c,"start",null))}return new A.bT(a,b,c,d.h("bT<0>"))},
fC(a,b,c,d){if(t.X.b(a))return new A.bm(a,b,c.h("@<0>").L(d).h("bm<1,2>"))
return new A.V(a,b,c.h("@<0>").L(d).h("V<1,2>"))},
fP(a,b,c){var s="takeCount"
A.aX(b,s,t.S)
A.Q(b,s)
if(t.X.b(a))return new A.bn(a,b,c.h("bn<0>"))
return new A.aN(a,b,c.h("aN<0>"))},
jh(a,b,c){var s="count"
if(t.X.b(a)){A.aX(b,s,t.S)
A.Q(b,s)
return new A.aZ(a,b,c.h("aZ<0>"))}A.aX(b,s,t.S)
A.Q(b,s)
return new A.ak(a,b,c.h("ak<0>"))},
b1(){return new A.aM("No element")},
fw(){return new A.aM("Too few elements")},
aB:function aB(){},
bk:function bk(a,b){this.a=a
this.$ti=b},
aF:function aF(a,b){this.a=a
this.$ti=b},
c_:function c_(a,b){this.a=a
this.$ti=b},
bZ:function bZ(){},
a7:function a7(a,b){this.a=a
this.$ti=b},
aG:function aG(a,b){this.a=a
this.$ti=b},
du:function du(a,b){this.a=a
this.b=b},
cB:function cB(a){this.a=a},
bl:function bl(a){this.a=a},
dS:function dS(){},
h:function h(){},
I:function I(){},
bT:function bT(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.$ti=d},
U:function U(a,b,c){var _=this
_.a=a
_.b=b
_.c=0
_.d=null
_.$ti=c},
V:function V(a,b,c){this.a=a
this.b=b
this.$ti=c},
bm:function bm(a,b,c){this.a=a
this.b=b
this.$ti=c},
bB:function bB(a,b,c){var _=this
_.a=null
_.b=a
_.c=b
_.$ti=c},
y:function y(a,b,c){this.a=a
this.b=b
this.$ti=c},
Y:function Y(a,b,c){this.a=a
this.b=b
this.$ti=c},
aP:function aP(a,b,c){this.a=a
this.b=b
this.$ti=c},
br:function br(a,b,c){this.a=a
this.b=b
this.$ti=c},
bs:function bs(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.d=null
_.$ti=d},
aN:function aN(a,b,c){this.a=a
this.b=b
this.$ti=c},
bn:function bn(a,b,c){this.a=a
this.b=b
this.$ti=c},
bU:function bU(a,b,c){this.a=a
this.b=b
this.$ti=c},
ak:function ak(a,b,c){this.a=a
this.b=b
this.$ti=c},
aZ:function aZ(a,b,c){this.a=a
this.b=b
this.$ti=c},
bN:function bN(a,b,c){this.a=a
this.b=b
this.$ti=c},
bO:function bO(a,b,c){this.a=a
this.b=b
this.$ti=c},
bP:function bP(a,b,c){var _=this
_.a=a
_.b=b
_.c=!1
_.$ti=c},
bo:function bo(a){this.$ti=a},
bp:function bp(a){this.$ti=a},
bF:function bF(a,b){this.a=a
this.$ti=b},
bG:function bG(a,b){this.a=a
this.b=null
this.$ti=b},
N:function N(){},
aO:function aO(){},
b4:function b4(){},
ca:function ca(){},
hQ(a){var s=A.hP(a)
if(s!=null)return s
return"minified:"+a},
l3(a,b){var s
if(b!=null){s=b.x
if(s!=null)return s}return t.v.b(a)},
i(a){var s
if(typeof a=="string")return a
if(typeof a=="number"){if(a!==0)return""+a}else if(!0===a)return"true"
else if(!1===a)return"false"
else if(a==null)return"null"
s=J.bj(a)
return s},
cT(a){var s,r=$.fG
if(r==null)r=$.fG=Symbol("identityHashCode")
s=a[r]
if(s==null){s=Math.random()*0x3fffffff|0
a[r]=s}return s},
fH(a,b){var s,r,q,p,o,n=null,m=/^\s*[+-]?((0x[a-f0-9]+)|(\d+)|([a-z0-9]+))\s*$/i.exec(a)
if(m==null)return n
if(3>=m.length)return A.a(m,3)
s=m[3]
if(b==null){if(s!=null)return parseInt(a,10)
if(m[2]!=null)return parseInt(a,16)
return n}if(b<2||b>36)throw A.b(A.B(b,2,36,"radix",n))
if(b===10&&s!=null)return parseInt(a,10)
if(b<10||s==null){r=b<=10?47+b:86+b
q=m[1]
for(p=q.length,o=0;o<p;++o)if((q.charCodeAt(o)|32)>r)return n}return parseInt(a,b)},
cU(a){var s,r,q,p
if(a instanceof A.r)return A.O(A.aa(a),null)
s=J.aS(a)
if(s===B.P||s===B.R||t.cB.b(a)){r=B.q(a)
if(r!=="Object"&&r!=="")return r
q=a.constructor
if(typeof q=="function"){p=q.name
if(typeof p=="string"&&p!=="Object"&&p!=="")return p}}return A.O(A.aa(a),null)},
jb(a){var s,r,q
if(typeof a=="number"||A.f3(a))return J.bj(a)
if(typeof a=="string")return JSON.stringify(a)
if(a instanceof A.M)return a.i(0)
s=$.il()
for(r=0;r<1;++r){q=s[r].ct(a)
if(q!=null)return q}return"Instance of '"+A.cU(a)+"'"},
ja(){if(!!self.location)return self.location.href
return null},
fF(a){var s,r,q,p,o=a.length
if(o<=500)return String.fromCharCode.apply(null,a)
for(s="",r=0;r<o;r=q){q=r+500
p=q<o?q:o
s+=String.fromCharCode.apply(null,a.slice(r,p))}return s},
jc(a){var s,r,q,p=A.f([],t.t)
for(s=a.length,r=0;r<a.length;a.length===s||(0,A.fg)(a),++r){q=a[r]
if(!A.er(q))throw A.b(A.cb(q))
if(q<=65535)B.b.k(p,q)
else if(q<=1114111){B.b.k(p,55296+(B.c.ao(q-65536,10)&1023))
B.b.k(p,56320+(q&1023))}else throw A.b(A.cb(q))}return A.fF(p)},
fI(a){var s,r,q
for(s=a.length,r=0;r<s;++r){q=a[r]
if(!A.er(q))throw A.b(A.cb(q))
if(q<0)throw A.b(A.cb(q))
if(q>65535)return A.jc(a)}return A.fF(a)},
jd(a,b,c){var s,r,q,p
if(c<=500&&b===0&&c===a.length)return String.fromCharCode.apply(null,a)
for(s=b,r="";s<c;s=q){q=s+500
p=q<c?q:c
r+=String.fromCharCode.apply(null,a.subarray(s,p))}return r},
P(a){var s
if(0<=a){if(a<=65535)return String.fromCharCode(a)
if(a<=1114111){s=a-65536
return String.fromCharCode((B.c.ao(s,10)|55296)>>>0,s&1023|56320)}}throw A.b(A.B(a,0,1114111,null,null))},
kY(a){throw A.b(A.cb(a))},
a(a,b){if(a==null)J.a5(a)
throw A.b(A.be(a,b))},
be(a,b){var s,r="index"
if(!A.er(b))return new A.a6(!0,b,r,null)
s=J.a5(a)
if(b<0||b>=s)return A.eI(b,s,a,r)
return A.dR(b,r)},
kS(a,b,c){if(a>c)return A.B(a,0,c,"start",null)
if(b!=null)if(b<a||b>c)return A.B(b,a,c,"end",null)
return new A.a6(!0,b,"end",null)},
cb(a){return new A.a6(!0,a,null,null)},
b(a){return A.G(a,new Error())},
G(a,b){var s
if(a==null)a=new A.bV()
b.dartException=a
s=A.lm
if("defineProperty" in Object){Object.defineProperty(b,"message",{get:s})
b.name=""}else b.toString=s
return b},
lm(){return J.bj(this.dartException)},
a4(a,b){throw A.G(a,b==null?new Error():b)},
H(a,b,c){var s
if(b==null)b=0
if(c==null)c=0
s=Error()
A.a4(A.kg(a,b,c),s)},
kg(a,b,c){var s,r,q,p,o,n,m,l,k
if(typeof b=="string")s=b
else{r="[]=;add;removeWhere;retainWhere;removeRange;setRange;setInt8;setInt16;setInt32;setUint8;setUint16;setUint32;setFloat32;setFloat64".split(";")
q=r.length
p=b
if(p>q){c=p/q|0
p%=q}s=r[p]}o=typeof c=="string"?c:"modify;remove from;add to".split(";")[c]
n=t.j.b(a)?"list":"ByteData"
m=a.$flags|0
l="a "
if((m&4)!==0)k="constant "
else if((m&2)!==0){k="unmodifiable "
l="an "}else k=(m&1)!==0?"fixed-length ":""
return new A.bW("'"+s+"': Cannot "+o+" "+l+k+n)},
fg(a){throw A.b(A.S(a))},
an(a){var s,r,q,p,o,n
a=A.hO(a.replace(String({}),"$receiver$"))
s=a.match(/\\\$[a-zA-Z]+\\\$/g)
if(s==null)s=A.f([],t.s)
r=s.indexOf("\\$arguments\\$")
q=s.indexOf("\\$argumentsExpr\\$")
p=s.indexOf("\\$expr\\$")
o=s.indexOf("\\$method\\$")
n=s.indexOf("\\$receiver\\$")
return new A.e5(a.replace(new RegExp("\\\\\\$arguments\\\\\\$","g"),"((?:x|[^x])*)").replace(new RegExp("\\\\\\$argumentsExpr\\\\\\$","g"),"((?:x|[^x])*)").replace(new RegExp("\\\\\\$expr\\\\\\$","g"),"((?:x|[^x])*)").replace(new RegExp("\\\\\\$method\\\\\\$","g"),"((?:x|[^x])*)").replace(new RegExp("\\\\\\$receiver\\\\\\$","g"),"((?:x|[^x])*)"),r,q,p,o,n)},
e6(a){return function($expr$){var $argumentsExpr$="$arguments$"
try{$expr$.$method$($argumentsExpr$)}catch(s){return s.message}}(a)},
fS(a){return function($expr$){try{$expr$.$method$}catch(s){return s.message}}(a)},
eL(a,b){var s=b==null,r=s?null:b.method
return new A.cy(a,r,s?null:b.receiver)},
cc(a){if(a==null)return new A.cP(a)
if(typeof a!=="object")return a
if("dartException" in a)return A.aV(a,a.dartException)
return A.kN(a)},
aV(a,b){if(t.C.b(b))if(b.$thrownJsError==null)b.$thrownJsError=a
return b},
kN(a){var s,r,q,p,o,n,m,l,k,j,i,h,g
if(!("message" in a))return a
s=a.message
if("number" in a&&typeof a.number=="number"){r=a.number
q=r&65535
if((B.c.ao(r,16)&8191)===10)switch(q){case 438:return A.aV(a,A.eL(A.i(s)+" (Error "+q+")",null))
case 445:case 5007:A.i(s)
return A.aV(a,new A.bI())}}if(a instanceof TypeError){p=$.hV()
o=$.hW()
n=$.hX()
m=$.hY()
l=$.i0()
k=$.i1()
j=$.i_()
$.hZ()
i=$.i3()
h=$.i2()
g=p.T(s)
if(g!=null)return A.aV(a,A.eL(A.m(s),g))
else{g=o.T(s)
if(g!=null){g.method="call"
return A.aV(a,A.eL(A.m(s),g))}else if(n.T(s)!=null||m.T(s)!=null||l.T(s)!=null||k.T(s)!=null||j.T(s)!=null||m.T(s)!=null||i.T(s)!=null||h.T(s)!=null){A.m(s)
return A.aV(a,new A.bI())}}return A.aV(a,new A.d5(typeof s=="string"?s:""))}if(a instanceof RangeError){if(typeof s=="string"&&s.indexOf("call stack")!==-1)return new A.bR()
s=function(b){try{return String(b)}catch(f){}return null}(a)
return A.aV(a,new A.a6(!1,null,null,typeof s=="string"?s.replace(/^RangeError:\s*/,""):s))}if(typeof InternalError=="function"&&a instanceof InternalError)if(typeof s=="string"&&s==="too much recursion")return new A.bR()
return a},
hJ(a){if(a==null)return J.aW(a)
if(typeof a=="object")return A.cT(a)
return J.aW(a)},
iP(a2){var s,r,q,p,o,n,m,l,k,j,i=a2.co,h=a2.iS,g=a2.iI,f=a2.nDA,e=a2.aI,d=a2.fs,c=a2.cs,b=d[0],a=c[0],a0=i[b],a1=a2.fT
a1.toString
s=h?Object.create(new A.d1().constructor.prototype):Object.create(new A.aY(null,null).constructor.prototype)
s.$initialize=s.constructor
r=h?function static_tear_off(){this.$initialize()}:function tear_off(a3,a4){this.$initialize(a3,a4)}
s.constructor=r
r.prototype=s
s.$_name=b
s.$_target=a0
q=!h
if(q)p=A.ft(b,a0,g,f)
else{s.$static_name=b
p=a0}s.$S=A.iL(a1,h,g)
s[a]=p
for(o=p,n=1;n<d.length;++n){m=d[n]
if(typeof m=="string"){l=i[m]
k=m
m=l}else k=""
j=c[n]
if(j!=null){if(q)m=A.ft(k,m,g,f)
s[j]=m}if(n===e)o=m}s.$C=o
s.$R=a2.rC
s.$D=a2.dV
return r},
iL(a,b,c){if(typeof a=="number")return a
if(typeof a=="string"){if(b)throw A.b("Cannot compute signature for static tearoff.")
return function(d,e){return function(){return e(this,d)}}(a,A.iI)}throw A.b("Error in functionType of tearoff")},
iM(a,b,c,d){var s=A.fs
switch(b?-1:a){case 0:return function(e,f){return function(){return f(this)[e]()}}(c,s)
case 1:return function(e,f){return function(g){return f(this)[e](g)}}(c,s)
case 2:return function(e,f){return function(g,h){return f(this)[e](g,h)}}(c,s)
case 3:return function(e,f){return function(g,h,i){return f(this)[e](g,h,i)}}(c,s)
case 4:return function(e,f){return function(g,h,i,j){return f(this)[e](g,h,i,j)}}(c,s)
case 5:return function(e,f){return function(g,h,i,j,k){return f(this)[e](g,h,i,j,k)}}(c,s)
default:return function(e,f){return function(){return e.apply(f(this),arguments)}}(d,s)}},
ft(a,b,c,d){if(c)return A.iO(a,b,d)
return A.iM(b.length,d,a,b)},
iN(a,b,c,d){var s=A.fs,r=A.iJ
switch(b?-1:a){case 0:throw A.b(new A.cV("Intercepted function with no arguments."))
case 1:return function(e,f,g){return function(){return f(this)[e](g(this))}}(c,r,s)
case 2:return function(e,f,g){return function(h){return f(this)[e](g(this),h)}}(c,r,s)
case 3:return function(e,f,g){return function(h,i){return f(this)[e](g(this),h,i)}}(c,r,s)
case 4:return function(e,f,g){return function(h,i,j){return f(this)[e](g(this),h,i,j)}}(c,r,s)
case 5:return function(e,f,g){return function(h,i,j,k){return f(this)[e](g(this),h,i,j,k)}}(c,r,s)
case 6:return function(e,f,g){return function(h,i,j,k,l){return f(this)[e](g(this),h,i,j,k,l)}}(c,r,s)
default:return function(e,f,g){return function(){var q=[g(this)]
Array.prototype.push.apply(q,arguments)
return e.apply(f(this),q)}}(d,r,s)}},
iO(a,b,c){var s,r
if($.fq==null)$.fq=A.fp("interceptor")
if($.fr==null)$.fr=A.fp("receiver")
s=b.length
r=A.iN(s,c,a,b)
return r},
f6(a){return A.iP(a)},
iI(a,b){return A.ed(v.typeUniverse,A.aa(a.a),b)},
fs(a){return a.a},
iJ(a){return a.b},
fp(a){var s,r,q,p=new A.aY("receiver","interceptor"),o=Object.getOwnPropertyNames(p)
o.$flags=1
s=o
for(o=s.length,r=0;r<o;++r){q=s[r]
if(p[q]===a)return q}throw A.b(A.L("Field name "+a+" not found."))},
ev(a){return v.getIsolateTag(a)},
lf(){return v.G},
ma(a,b,c){Object.defineProperty(a,b,{value:c,enumerable:false,writable:true,configurable:true})},
l4(a){var s,r,q,p,o,n=A.m($.hG.$1(a)),m=$.eu[n]
if(m!=null){Object.defineProperty(a,v.dispatchPropertyName,{value:m,enumerable:false,writable:true,configurable:true})
return m.i}s=$.eA[n]
if(s!=null)return s
r=v.interceptorsByTag[n]
if(r==null){q=A.dn($.hC.$2(a,n))
if(q!=null){m=$.eu[q]
if(m!=null){Object.defineProperty(a,v.dispatchPropertyName,{value:m,enumerable:false,writable:true,configurable:true})
return m.i}s=$.eA[q]
if(s!=null)return s
r=v.interceptorsByTag[q]
n=q}}if(r==null)return null
s=r.prototype
p=n[0]
if(p==="!"){m=A.eB(s)
$.eu[n]=m
Object.defineProperty(a,v.dispatchPropertyName,{value:m,enumerable:false,writable:true,configurable:true})
return m.i}if(p==="~"){$.eA[n]=s
return s}if(p==="-"){o=A.eB(s)
Object.defineProperty(Object.getPrototypeOf(a),v.dispatchPropertyName,{value:o,enumerable:false,writable:true,configurable:true})
return o.i}if(p==="+")return A.hL(a,s)
if(p==="*")throw A.b(A.fT(n))
if(v.leafTags[n]===true){o=A.eB(s)
Object.defineProperty(Object.getPrototypeOf(a),v.dispatchPropertyName,{value:o,enumerable:false,writable:true,configurable:true})
return o.i}else return A.hL(a,s)},
hL(a,b){var s=Object.getPrototypeOf(a)
Object.defineProperty(s,v.dispatchPropertyName,{value:J.fe(b,s,null,null),enumerable:false,writable:true,configurable:true})
return b},
eB(a){return J.fe(a,!1,null,!!a.$iT)},
l6(a,b,c){var s=b.prototype
if(v.leafTags[a]===true)return A.eB(s)
else return J.fe(s,c,null,null)},
l_(){if(!0===$.fb)return
$.fb=!0
A.l0()},
l0(){var s,r,q,p,o,n,m,l
$.eu=Object.create(null)
$.eA=Object.create(null)
A.kZ()
s=v.interceptorsByTag
r=Object.getOwnPropertyNames(s)
if(typeof window!="undefined"){window
q=function(){}
for(p=0;p<r.length;++p){o=r[p]
n=$.hN.$1(o)
if(n!=null){m=A.l6(o,s[o],n)
if(m!=null){Object.defineProperty(n,v.dispatchPropertyName,{value:m,enumerable:false,writable:true,configurable:true})
q.prototype=n}}}}for(p=0;p<r.length;++p){o=r[p]
if(/^[A-Za-z_]/.test(o)){l=s[o]
s["!"+o]=l
s["~"+o]=l
s["-"+o]=l
s["+"+o]=l
s["*"+o]=l}}},
kZ(){var s,r,q,p,o,n,m=B.z()
m=A.bd(B.A,A.bd(B.B,A.bd(B.r,A.bd(B.r,A.bd(B.C,A.bd(B.D,A.bd(B.E(B.q),m)))))))
if(typeof dartNativeDispatchHooksTransformer!="undefined"){s=dartNativeDispatchHooksTransformer
if(typeof s=="function")s=[s]
if(Array.isArray(s))for(r=0;r<s.length;++r){q=s[r]
if(typeof q=="function")m=q(m)||m}}p=m.getTag
o=m.getUnknownTag
n=m.prototypeForTag
$.hG=new A.ex(p)
$.hC=new A.ey(o)
$.hN=new A.ez(n)},
bd(a,b){return a(b)||b},
kR(a,b){var s=b.length,r=v.rttc[""+s+";"+a]
if(r==null)return null
if(s===0)return r
if(s===r.length)return r.apply(null,b)
return r(b)},
eJ(a,b,c,d,e,f){var s=b?"m":"",r=c?"":"i",q=d?"u":"",p=e?"s":"",o=function(g,h){try{return new RegExp(g,h)}catch(n){return n}}(a,s+r+q+p+f)
if(o instanceof RegExp)return o
throw A.b(A.z("Illegal RegExp pattern ("+String(o)+")",a,null))},
lg(a,b,c){var s
if(typeof b=="string")return a.indexOf(b,c)>=0
else if(b instanceof A.au){s=B.a.B(a,c)
return b.b.test(s)}else return!J.eG(b,B.a.B(a,c)).gcl(0)},
f8(a){if(a.indexOf("$",0)>=0)return a.replace(/\$/g,"$$$$")
return a},
lk(a,b,c,d){var s=b.bg(a,d)
if(s==null)return a
return A.ff(a,s.b.index,s.gM(),c)},
hO(a){if(/[[\]{}()*+?.\\^$|]/.test(a))return a.replace(/[[\]{}()*+?.\\^$|]/g,"\\$&")
return a},
a0(a,b,c){var s
if(typeof b=="string")return A.lj(a,b,c)
if(b instanceof A.au){s=b.gbk()
s.lastIndex=0
return a.replace(s,A.f8(c))}return A.li(a,b,c)},
li(a,b,c){var s,r,q,p
for(s=J.eG(b,a),s=s.gt(s),r=0,q="";s.m();){p=s.gn()
q=q+a.substring(r,p.gJ())+c
r=p.gM()}s=q+a.substring(r)
return s.charCodeAt(0)==0?s:s},
lj(a,b,c){var s,r,q
if(b===""){if(a==="")return c
s=a.length
for(r=c,q=0;q<s;++q)r=r+a[q]+c
return r.charCodeAt(0)==0?r:r}if(a.indexOf(b,0)<0)return a
if(a.length<500||c.indexOf("$",0)>=0)return a.split(b).join(c)
return a.replace(new RegExp(A.hO(b),"g"),A.f8(c))},
kC(a){var s=a.p(0,0)
s.toString
return s},
hA(a){return a},
lh(a,b,c,d){var s,r,q,p,o,n,m
if(c==null)c=A.kB()
for(s=b.ap(0,a),s=new A.bY(s.a,s.b,s.c),r=t.k,q=0,p="";s.m();){o=s.d
if(o==null)o=r.a(o)
n=o.b
m=n.index
p=p+A.i(A.hA(B.a.j(a,q,m)))+A.i(c.$1(o))
q=m+n[0].length}s=p+A.i(A.hA(B.a.B(a,q)))
return s.charCodeAt(0)==0?s:s},
ll(a,b,c,d){var s,r,q,p
if(typeof b=="string"){s=a.indexOf(b,d)
if(s<0)return a
return A.ff(a,s,s+b.length,c)}if(b instanceof A.au)return d===0?a.replace(b.b,A.f8(c)):A.lk(a,b,c,d)
r=J.iA(b,a,d)
q=r.gt(r)
if(!q.m())return a
p=q.gn()
return B.a.U(a,p.gJ(),p.gM(),c)},
ff(a,b,c,d){return a.substring(0,b)+d+a.substring(c)},
cs:function cs(){},
b_:function b_(a,b){this.a=a
this.$ti=b},
bL:function bL(){},
e5:function e5(a,b,c,d,e,f){var _=this
_.a=a
_.b=b
_.c=c
_.d=d
_.e=e
_.f=f},
bI:function bI(){},
cy:function cy(a,b,c){this.a=a
this.b=b
this.c=c},
d5:function d5(a){this.a=a},
cP:function cP(a){this.a=a},
M:function M(){},
cl:function cl(){},
cm:function cm(){},
d3:function d3(){},
d1:function d1(){},
aY:function aY(a,b){this.a=a
this.b=b},
cV:function cV(a){this.a=a},
bz:function bz(a){var _=this
_.a=0
_.f=_.e=_.d=_.c=_.b=null
_.r=0
_.$ti=a},
dL:function dL(a,b){this.a=a
this.b=b
this.c=null},
aI:function aI(a,b){this.a=a
this.$ti=b},
bA:function bA(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.d=null
_.$ti=d},
dM:function dM(a,b){this.a=a
this.$ti=b},
aJ:function aJ(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.d=null
_.$ti=d},
ex:function ex(a){this.a=a},
ey:function ey(a){this.a=a},
ez:function ez(a){this.a=a},
au:function au(a,b){var _=this
_.a=a
_.b=b
_.e=_.d=_.c=null},
b5:function b5(a){this.b=a},
dd:function dd(a,b,c){this.a=a
this.b=b
this.c=c},
bY:function bY(a,b,c){var _=this
_.a=a
_.b=b
_.c=c
_.d=null},
bS:function bS(a,b){this.a=a
this.c=b},
dk:function dk(a,b,c){this.a=a
this.b=b
this.c=c},
dl:function dl(a,b,c){var _=this
_.a=a
_.b=b
_.c=c
_.d=null},
kh(a){return a},
j9(a){return new Uint8Array(a)},
ao(a,b,c){if(a>>>0!==a||a>=c)throw A.b(A.be(b,a))},
kf(a,b,c){var s
if(!(a>>>0!==a))if(b==null)s=a>c
else s=b>>>0!==b||a>b||b>c
else s=!0
if(s)throw A.b(A.kS(a,b,c))
if(b==null)return c
return b},
b2:function b2(){},
bD:function bD(){},
cH:function cH(){},
J:function J(){},
bC:function bC(){},
W:function W(){},
cI:function cI(){},
cJ:function cJ(){},
cK:function cK(){},
cL:function cL(){},
cM:function cM(){},
cN:function cN(){},
cO:function cO(){},
bE:function bE(){},
aK:function aK(){},
c0:function c0(){},
c1:function c1(){},
c2:function c2(){},
c3:function c3(){},
eO(a,b){var s=b.c
return s==null?b.c=A.c5(a,"fv",[b.x]):s},
fK(a){var s=a.w
if(s===6||s===7)return A.fK(a.x)
return s===11||s===12},
jf(a){return a.as},
bf(a){return A.ec(v.typeUniverse,a,!1)},
l2(a,b){var s,r,q,p,o
if(a==null)return null
s=b.y
r=a.Q
if(r==null)r=a.Q=new Map()
q=b.as
p=r.get(q)
if(p!=null)return p
o=A.aD(v.typeUniverse,a.x,s,0)
r.set(q,o)
return o},
aD(a1,a2,a3,a4){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c,b,a,a0=a2.w
switch(a0){case 5:case 1:case 2:case 3:case 4:return a2
case 6:s=a2.x
r=A.aD(a1,s,a3,a4)
if(r===s)return a2
return A.h5(a1,r,!0)
case 7:s=a2.x
r=A.aD(a1,s,a3,a4)
if(r===s)return a2
return A.h4(a1,r,!0)
case 8:q=a2.y
p=A.bc(a1,q,a3,a4)
if(p===q)return a2
return A.c5(a1,a2.x,p)
case 9:o=a2.x
n=A.aD(a1,o,a3,a4)
m=a2.y
l=A.bc(a1,m,a3,a4)
if(n===o&&l===m)return a2
return A.eW(a1,n,l)
case 10:k=a2.x
j=a2.y
i=A.bc(a1,j,a3,a4)
if(i===j)return a2
return A.h6(a1,k,i)
case 11:h=a2.x
g=A.aD(a1,h,a3,a4)
f=a2.y
e=A.kJ(a1,f,a3,a4)
if(g===h&&e===f)return a2
return A.h3(a1,g,e)
case 12:d=a2.y
a4+=d.length
c=A.bc(a1,d,a3,a4)
o=a2.x
n=A.aD(a1,o,a3,a4)
if(c===d&&n===o)return a2
return A.eX(a1,n,c,!0)
case 13:b=a2.x
if(b<a4)return a2
a=a3[b-a4]
if(a==null)return a2
return a
default:throw A.b(A.ci("Attempted to substitute unexpected RTI kind "+a0))}},
bc(a,b,c,d){var s,r,q,p,o=b.length,n=A.em(o)
for(s=!1,r=0;r<o;++r){q=b[r]
p=A.aD(a,q,c,d)
if(p!==q)s=!0
n[r]=p}return s?n:b},
kK(a,b,c,d){var s,r,q,p,o,n,m=b.length,l=A.em(m)
for(s=!1,r=0;r<m;r+=3){q=b[r]
p=b[r+1]
o=b[r+2]
n=A.aD(a,o,c,d)
if(n!==o)s=!0
l.splice(r,3,q,p,n)}return s?l:b},
kJ(a,b,c,d){var s,r=b.a,q=A.bc(a,r,c,d),p=b.b,o=A.bc(a,p,c,d),n=b.c,m=A.kK(a,n,c,d)
if(q===r&&o===p&&m===n)return b
s=new A.dg()
s.a=q
s.b=o
s.c=m
return s},
f(a,b){a[v.arrayRti]=b
return a},
et(a){var s=a.$S
if(s!=null){if(typeof s=="number")return A.kX(s)
return a.$S()}return null},
l1(a,b){var s
if(A.fK(b))if(a instanceof A.M){s=A.et(a)
if(s!=null)return s}return A.aa(a)},
aa(a){if(a instanceof A.r)return A.t(a)
if(Array.isArray(a))return A.w(a)
return A.f2(J.aS(a))},
w(a){var s=a[v.arrayRti],r=t.b
if(s==null)return r
if(s.constructor!==r.constructor)return r
return s},
t(a){var s=a.$ti
return s!=null?s:A.f2(a)},
f2(a){var s=a.constructor,r=s.$ccache
if(r!=null)return r
return A.kp(a,s)},
kp(a,b){var s=a instanceof A.M?Object.getPrototypeOf(Object.getPrototypeOf(a)).constructor:b,r=A.jR(v.typeUniverse,s.name)
b.$ccache=r
return r},
kX(a){var s,r=v.types,q=r[a]
if(typeof q=="string"){s=A.ec(v.typeUniverse,q,!1)
r[a]=s
return s}return q},
bh(a){return A.ap(A.t(a))},
fa(a){var s=A.et(a)
return A.ap(s==null?A.aa(a):s)},
kI(a){var s=a instanceof A.M?A.et(a):null
if(s!=null)return s
if(t.bW.b(a))return J.iE(a).a
if(Array.isArray(a))return A.w(a)
return A.aa(a)},
ap(a){var s=a.r
return s==null?a.r=new A.eb(a):s},
ab(a){return A.ap(A.ec(v.typeUniverse,a,!1))},
ko(a){var s=this
s.b=A.kH(s)
return s.b(a)},
kH(a){var s,r,q,p,o
if(a===t.K)return A.kv
if(A.aU(a))return A.kz
s=a.w
if(s===6)return A.kl
if(s===1)return A.hv
if(s===7)return A.kq
r=A.kG(a)
if(r!=null)return r
if(s===8){q=a.x
if(a.y.every(A.aU)){a.f="$i"+q
if(q==="j")return A.kt
if(a===t.m)return A.ks
return A.ky}}else if(s===10){p=A.kR(a.x,a.y)
o=p==null?A.hv:p
return o==null?A.en(o):o}return A.kj},
kG(a){if(a.w===8){if(a===t.S)return A.er
if(a===t.i||a===t.H)return A.ku
if(a===t.N)return A.kx
if(a===t.y)return A.f3}return null},
kn(a){var s=this,r=A.ki
if(A.aU(s))r=A.kc
else if(s===t.K)r=A.en
else if(A.bi(s)){r=A.kk
if(s===t.a3)r=A.f1
else if(s===t.u)r=A.dn
else if(s===t.cG)r=A.k7
else if(s===t.n)r=A.ho
else if(s===t.dd)r=A.k8
else if(s===t.aQ)r=A.ka}else if(s===t.S)r=A.bb
else if(s===t.N)r=A.m
else if(s===t.y)r=A.k6
else if(s===t.H)r=A.kb
else if(s===t.i)r=A.hn
else if(s===t.m)r=A.k9
s.a=r
return s.a(a)},
kj(a){var s=this
if(a==null)return A.bi(s)
return A.hH(v.typeUniverse,A.l1(a,s),s)},
kl(a){if(a==null)return!0
return this.x.b(a)},
ky(a){var s,r=this
if(a==null)return A.bi(r)
s=r.f
if(a instanceof A.r)return!!a[s]
return!!J.aS(a)[s]},
kt(a){var s,r=this
if(a==null)return A.bi(r)
if(typeof a!="object")return!1
if(Array.isArray(a))return!0
s=r.f
if(a instanceof A.r)return!!a[s]
return!!J.aS(a)[s]},
ks(a){var s=this
if(a==null)return!1
if(typeof a=="object"){if(a instanceof A.r)return!!a[s.f]
return!0}if(typeof a=="function")return!0
return!1},
hu(a){if(typeof a=="object"){if(a instanceof A.r)return t.m.b(a)
return!0}if(typeof a=="function")return!0
return!1},
ki(a){var s=this
if(a==null){if(A.bi(s))return a}else if(s.b(a))return a
throw A.G(A.hq(a,s),new Error())},
kk(a){var s=this
if(a==null||s.b(a))return a
throw A.G(A.hq(a,s),new Error())},
hq(a,b){return new A.b9("TypeError: "+A.fZ(a,A.O(b,null)))},
kP(a,b,c,d){if(A.hH(v.typeUniverse,a,b))return a
throw A.G(A.jI("The type argument '"+A.O(a,null)+"' is not a subtype of the type variable bound '"+A.O(b,null)+"' of type variable '"+c+"' in '"+d+"'."),new Error())},
fZ(a,b){return A.dD(a)+": type '"+A.O(A.kI(a),null)+"' is not a subtype of type '"+b+"'"},
jI(a){return new A.b9("TypeError: "+a)},
a2(a,b){return new A.b9("TypeError: "+A.fZ(a,b))},
kq(a){var s=this
return s.x.b(a)||A.eO(v.typeUniverse,s).b(a)},
kv(a){return a!=null},
en(a){if(a!=null)return a
throw A.G(A.a2(a,"Object"),new Error())},
kz(a){return!0},
kc(a){return a},
hv(a){return!1},
f3(a){return!0===a||!1===a},
k6(a){if(!0===a)return!0
if(!1===a)return!1
throw A.G(A.a2(a,"bool"),new Error())},
k7(a){if(!0===a)return!0
if(!1===a)return!1
if(a==null)return a
throw A.G(A.a2(a,"bool?"),new Error())},
hn(a){if(typeof a=="number")return a
throw A.G(A.a2(a,"double"),new Error())},
k8(a){if(typeof a=="number")return a
if(a==null)return a
throw A.G(A.a2(a,"double?"),new Error())},
er(a){return typeof a=="number"&&Math.floor(a)===a},
bb(a){if(typeof a=="number"&&Math.floor(a)===a)return a
throw A.G(A.a2(a,"int"),new Error())},
f1(a){if(typeof a=="number"&&Math.floor(a)===a)return a
if(a==null)return a
throw A.G(A.a2(a,"int?"),new Error())},
ku(a){return typeof a=="number"},
kb(a){if(typeof a=="number")return a
throw A.G(A.a2(a,"num"),new Error())},
ho(a){if(typeof a=="number")return a
if(a==null)return a
throw A.G(A.a2(a,"num?"),new Error())},
kx(a){return typeof a=="string"},
m(a){if(typeof a=="string")return a
throw A.G(A.a2(a,"String"),new Error())},
dn(a){if(typeof a=="string")return a
if(a==null)return a
throw A.G(A.a2(a,"String?"),new Error())},
k9(a){if(A.hu(a))return a
throw A.G(A.a2(a,"JSObject"),new Error())},
ka(a){if(a==null)return a
if(A.hu(a))return a
throw A.G(A.a2(a,"JSObject?"),new Error())},
hx(a,b){var s,r,q
for(s="",r="",q=0;q<a.length;++q,r=", ")s+=r+A.O(a[q],b)
return s},
kF(a,b){var s,r,q,p,o,n,m=a.x,l=a.y
if(""===m)return"("+A.hx(l,b)+")"
s=l.length
r=m.split(",")
q=r.length-s
for(p="(",o="",n=0;n<s;++n,o=", "){p+=o
if(q===0)p+="{"
p+=A.O(l[n],b)
if(q>=0)p+=" "+r[q];++q}return p+"})"},
hr(a3,a4,a5){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c,b,a,a0,a1=", ",a2=null
if(a5!=null){s=a5.length
if(a4==null)a4=A.f([],t.s)
else a2=a4.length
r=a4.length
for(q=s;q>0;--q)B.b.k(a4,"T"+(r+q))
for(p=t.V,o="<",n="",q=0;q<s;++q,n=a1){m=a4.length
l=m-1-q
if(!(l>=0))return A.a(a4,l)
o=o+n+a4[l]
k=a5[q]
j=k.w
if(!(j===2||j===3||j===4||j===5||k===p))o+=" extends "+A.O(k,a4)}o+=">"}else o=""
p=a3.x
i=a3.y
h=i.a
g=h.length
f=i.b
e=f.length
d=i.c
c=d.length
b=A.O(p,a4)
for(a="",a0="",q=0;q<g;++q,a0=a1)a+=a0+A.O(h[q],a4)
if(e>0){a+=a0+"["
for(a0="",q=0;q<e;++q,a0=a1)a+=a0+A.O(f[q],a4)
a+="]"}if(c>0){a+=a0+"{"
for(a0="",q=0;q<c;q+=3,a0=a1){a+=a0
if(d[q+1])a+="required "
a+=A.O(d[q+2],a4)+" "+d[q]}a+="}"}if(a2!=null){a4.toString
a4.length=a2}return o+"("+a+") => "+b},
O(a,b){var s,r,q,p,o,n,m,l=a.w
if(l===5)return"erased"
if(l===2)return"dynamic"
if(l===3)return"void"
if(l===1)return"Never"
if(l===4)return"any"
if(l===6){s=a.x
r=A.O(s,b)
q=s.w
return(q===11||q===12?"("+r+")":r)+"?"}if(l===7)return"FutureOr<"+A.O(a.x,b)+">"
if(l===8){p=A.kM(a.x)
o=a.y
return o.length>0?p+("<"+A.hx(o,b)+">"):p}if(l===10)return A.kF(a,b)
if(l===11)return A.hr(a,b,null)
if(l===12)return A.hr(a.x,b,a.y)
if(l===13){n=a.x
m=b.length
n=m-1-n
if(!(n>=0&&n<m))return A.a(b,n)
return b[n]}return"?"},
kM(a){var s=A.hP(a)
if(s!=null)return s
return"minified:"+a},
jS(a,b){var s=a.tR[b]
while(typeof s=="string")s=a.tR[s]
return s},
jR(a,b){var s,r,q,p,o,n=a.eT,m=n[b]
if(m==null)return A.ec(a,b,!1)
else if(typeof m=="number"){s=m
r=A.c6(a,5,"#")
q=A.em(s)
for(p=0;p<s;++p)q[p]=r
o=A.c5(a,b,q)
n[b]=o
return o}else return m},
jP(a,b){return A.hl(a.tR,b)},
jO(a,b){return A.hl(a.eT,b)},
ec(a,b,c){var s,r=a.eC,q=r.get(b)
if(q!=null)return q
s=A.h7(a,null,b,!1)
r.set(b,s)
return s},
ed(a,b,c){var s,r,q=b.z
if(q==null)q=b.z=new Map()
s=q.get(c)
if(s!=null)return s
r=A.h7(a,b,c,!0)
q.set(c,r)
return r},
jQ(a,b,c){var s,r,q,p=b.Q
if(p==null)p=b.Q=new Map()
s=c.as
r=p.get(s)
if(r!=null)return r
q=A.eW(a,b,c.w===9?c.y:[c])
p.set(s,q)
return q},
h7(a,b,c,d){return A.jG(A.jA(a,b,c,d))},
aC(a,b){b.a=A.kn
b.b=A.ko
return b},
c6(a,b,c){var s,r,q=a.eC.get(c)
if(q!=null)return q
s=new A.a9(null,null)
s.w=b
s.as=c
r=A.aC(a,s)
a.eC.set(c,r)
return r},
h5(a,b,c){var s,r=b.as+"?",q=a.eC.get(r)
if(q!=null)return q
s=A.jM(a,b,r,c)
a.eC.set(r,s)
return s},
jM(a,b,c,d){var s,r,q
if(d){s=b.w
r=!0
if(!A.aU(b))if(!(b===t.P||b===t.T))if(s!==6)r=s===7&&A.bi(b.x)
if(r)return b
else if(s===1)return t.P}q=new A.a9(null,null)
q.w=6
q.x=b
q.as=c
return A.aC(a,q)},
h4(a,b,c){var s,r=b.as+"/",q=a.eC.get(r)
if(q!=null)return q
s=A.jK(a,b,r,c)
a.eC.set(r,s)
return s},
jK(a,b,c,d){var s,r
if(d){s=b.w
if(A.aU(b)||b===t.K)return b
else if(s===1)return A.c5(a,"fv",[b])
else if(b===t.P||b===t.T)return t.bc}r=new A.a9(null,null)
r.w=7
r.x=b
r.as=c
return A.aC(a,r)},
jN(a,b){var s,r,q=""+b+"^",p=a.eC.get(q)
if(p!=null)return p
s=new A.a9(null,null)
s.w=13
s.x=b
s.as=q
r=A.aC(a,s)
a.eC.set(q,r)
return r},
c4(a){var s,r,q,p=a.length
for(s="",r="",q=0;q<p;++q,r=",")s+=r+a[q].as
return s},
jJ(a){var s,r,q,p,o,n=a.length
for(s="",r="",q=0;q<n;q+=3,r=","){p=a[q]
o=a[q+1]?"!":":"
s+=r+p+o+a[q+2].as}return s},
c5(a,b,c){var s,r,q,p=b
if(c.length>0)p+="<"+A.c4(c)+">"
s=a.eC.get(p)
if(s!=null)return s
r=new A.a9(null,null)
r.w=8
r.x=b
r.y=c
if(c.length>0)r.c=c[0]
r.as=p
q=A.aC(a,r)
a.eC.set(p,q)
return q},
eW(a,b,c){var s,r,q,p,o,n
if(b.w===9){s=b.x
r=b.y.concat(c)}else{r=c
s=b}q=s.as+(";<"+A.c4(r)+">")
p=a.eC.get(q)
if(p!=null)return p
o=new A.a9(null,null)
o.w=9
o.x=s
o.y=r
o.as=q
n=A.aC(a,o)
a.eC.set(q,n)
return n},
h6(a,b,c){var s,r,q="+"+(b+"("+A.c4(c)+")"),p=a.eC.get(q)
if(p!=null)return p
s=new A.a9(null,null)
s.w=10
s.x=b
s.y=c
s.as=q
r=A.aC(a,s)
a.eC.set(q,r)
return r},
h3(a,b,c){var s,r,q,p,o,n=b.as,m=c.a,l=m.length,k=c.b,j=k.length,i=c.c,h=i.length,g="("+A.c4(m)
if(j>0){s=l>0?",":""
g+=s+"["+A.c4(k)+"]"}if(h>0){s=l>0?",":""
g+=s+"{"+A.jJ(i)+"}"}r=n+(g+")")
q=a.eC.get(r)
if(q!=null)return q
p=new A.a9(null,null)
p.w=11
p.x=b
p.y=c
p.as=r
o=A.aC(a,p)
a.eC.set(r,o)
return o},
eX(a,b,c,d){var s,r=b.as+("<"+A.c4(c)+">"),q=a.eC.get(r)
if(q!=null)return q
s=A.jL(a,b,c,r,d)
a.eC.set(r,s)
return s},
jL(a,b,c,d,e){var s,r,q,p,o,n,m,l
if(e){s=c.length
r=A.em(s)
for(q=0,p=0;p<s;++p){o=c[p]
if(o.w===1){r[p]=o;++q}}if(q>0){n=A.aD(a,b,r,0)
m=A.bc(a,c,r,0)
return A.eX(a,n,m,c!==m)}}l=new A.a9(null,null)
l.w=12
l.x=b
l.y=c
l.as=d
return A.aC(a,l)},
jA(a,b,c,d){return{u:a,e:b,r:c,s:[],p:0,n:d}},
jG(a){var s,r,q,p,o,n,m,l=a.r,k=a.s
for(s=l.length,r=0;r<s;){q=l.charCodeAt(r)
if(q>=48&&q<=57)r=A.jC(r+1,q,l,k)
else if((((q|32)>>>0)-97&65535)<26||q===95||q===36||q===124)r=A.h0(a,r,l,k,!1)
else if(q===46)r=A.h0(a,r,l,k,!0)
else{++r
switch(q){case 44:break
case 58:k.push(!1)
break
case 33:k.push(!0)
break
case 59:k.push(A.aQ(a.u,a.e,k.pop()))
break
case 94:k.push(A.jN(a.u,k.pop()))
break
case 35:k.push(A.c6(a.u,5,"#"))
break
case 64:k.push(A.c6(a.u,2,"@"))
break
case 126:k.push(A.c6(a.u,3,"~"))
break
case 60:k.push(a.p)
a.p=k.length
break
case 62:A.jE(a,k)
break
case 38:A.jD(a,k)
break
case 63:p=a.u
k.push(A.h5(p,A.aQ(p,a.e,k.pop()),a.n))
break
case 47:p=a.u
k.push(A.h4(p,A.aQ(p,a.e,k.pop()),a.n))
break
case 40:k.push(-3)
k.push(a.p)
a.p=k.length
break
case 41:A.jB(a,k)
break
case 91:k.push(a.p)
a.p=k.length
break
case 93:o=k.splice(a.p)
A.h1(a.u,a.e,o)
a.p=k.pop()
k.push(o)
k.push(-1)
break
case 123:k.push(a.p)
a.p=k.length
break
case 125:o=k.splice(a.p)
A.jH(a.u,a.e,o)
a.p=k.pop()
k.push(o)
k.push(-2)
break
case 43:n=l.indexOf("(",r)
k.push(l.substring(r,n))
k.push(-4)
k.push(a.p)
a.p=k.length
r=n+1
break
default:throw"Bad character "+q}}}m=k.pop()
return A.aQ(a.u,a.e,m)},
jC(a,b,c,d){var s,r,q=b-48
for(s=c.length;a<s;++a){r=c.charCodeAt(a)
if(!(r>=48&&r<=57))break
q=q*10+(r-48)}d.push(q)
return a},
h0(a,b,c,d,e){var s,r,q,p,o,n,m=b+1
for(s=c.length;m<s;++m){r=c.charCodeAt(m)
if(r===46){if(e)break
e=!0}else{if(!((((r|32)>>>0)-97&65535)<26||r===95||r===36||r===124))q=r>=48&&r<=57
else q=!0
if(!q)break}}p=c.substring(b,m)
if(e){s=a.u
o=a.e
if(o.w===9)o=o.x
n=A.jS(s,o.x)[p]
if(n==null)A.a4('No "'+p+'" in "'+A.jf(o)+'"')
d.push(A.ed(s,o,n))}else d.push(p)
return m},
jE(a,b){var s,r=a.u,q=A.h_(a,b),p=b.pop()
if(typeof p=="string")b.push(A.c5(r,p,q))
else{s=A.aQ(r,a.e,p)
switch(s.w){case 11:b.push(A.eX(r,s,q,a.n))
break
default:b.push(A.eW(r,s,q))
break}}},
jB(a,b){var s,r,q,p=a.u,o=b.pop(),n=null,m=null
if(typeof o=="number")switch(o){case-1:n=b.pop()
break
case-2:m=b.pop()
break
default:b.push(o)
break}else b.push(o)
s=A.h_(a,b)
o=b.pop()
switch(o){case-3:o=b.pop()
if(n==null)n=p.sEA
if(m==null)m=p.sEA
r=A.aQ(p,a.e,o)
q=new A.dg()
q.a=s
q.b=n
q.c=m
b.push(A.h3(p,r,q))
return
case-4:b.push(A.h6(p,b.pop(),s))
return
default:throw A.b(A.ci("Unexpected state under `()`: "+A.i(o)))}},
jD(a,b){var s=b.pop()
if(0===s){b.push(A.c6(a.u,1,"0&"))
return}if(1===s){b.push(A.c6(a.u,4,"1&"))
return}throw A.b(A.ci("Unexpected extended operation "+A.i(s)))},
h_(a,b){var s=b.splice(a.p)
A.h1(a.u,a.e,s)
a.p=b.pop()
return s},
aQ(a,b,c){if(typeof c=="string")return A.c5(a,c,a.sEA)
else if(typeof c=="number"){b.toString
return A.jF(a,b,c)}else return c},
h1(a,b,c){var s,r=c.length
for(s=0;s<r;++s)c[s]=A.aQ(a,b,c[s])},
jH(a,b,c){var s,r=c.length
for(s=2;s<r;s+=3)c[s]=A.aQ(a,b,c[s])},
jF(a,b,c){var s,r,q=b.w
if(q===9){if(c===0)return b.x
s=b.y
r=s.length
if(c<=r)return s[c-1]
c-=r
b=b.x
q=b.w}else if(c===0)return b
if(q!==8)throw A.b(A.ci("Indexed base must be an interface type"))
s=b.y
if(c<=s.length)return s[c-1]
throw A.b(A.ci("Bad index "+c+" for "+b.i(0)))},
hH(a,b,c){var s,r=b.d
if(r==null)r=b.d=new Map()
s=r.get(c)
if(s==null){s=A.C(a,b,null,c,null)
r.set(c,s)}return s},
C(a,b,c,d,e){var s,r,q,p,o,n,m,l,k,j,i
if(b===d)return!0
if(A.aU(d))return!0
s=b.w
if(s===4)return!0
if(A.aU(b))return!1
if(b.w===1)return!0
r=s===13
if(r)if(A.C(a,c[b.x],c,d,e))return!0
q=d.w
p=t.P
if(b===p||b===t.T){if(q===7)return A.C(a,b,c,d.x,e)
return d===p||d===t.T||q===6}if(d===t.K){if(s===7)return A.C(a,b.x,c,d,e)
return s!==6}if(s===7){if(!A.C(a,b.x,c,d,e))return!1
return A.C(a,A.eO(a,b),c,d,e)}if(s===6)return A.C(a,p,c,d,e)&&A.C(a,b.x,c,d,e)
if(q===7){if(A.C(a,b,c,d.x,e))return!0
return A.C(a,b,c,A.eO(a,d),e)}if(q===6)return A.C(a,b,c,p,e)||A.C(a,b,c,d.x,e)
if(r)return!1
p=s!==11
if((!p||s===12)&&d===t.Z)return!0
o=s===10
if(o&&d===t.cY)return!0
if(q===12){if(b===t.g)return!0
if(s!==12)return!1
n=b.y
m=d.y
l=n.length
if(l!==m.length)return!1
c=c==null?n:n.concat(c)
e=e==null?m:m.concat(e)
for(k=0;k<l;++k){j=n[k]
i=m[k]
if(!A.C(a,j,c,i,e)||!A.C(a,i,e,j,c))return!1}return A.ht(a,b.x,c,d.x,e)}if(q===11){if(b===t.g)return!0
if(p)return!1
return A.ht(a,b,c,d,e)}if(s===8){if(q!==8)return!1
return A.kr(a,b,c,d,e)}if(o&&q===10)return A.kw(a,b,c,d,e)
return!1},
ht(a3,a4,a5,a6,a7){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c,b,a,a0,a1,a2
if(!A.C(a3,a4.x,a5,a6.x,a7))return!1
s=a4.y
r=a6.y
q=s.a
p=r.a
o=q.length
n=p.length
if(o>n)return!1
m=n-o
l=s.b
k=r.b
j=l.length
i=k.length
if(o+j<n+i)return!1
for(h=0;h<o;++h){g=q[h]
if(!A.C(a3,p[h],a7,g,a5))return!1}for(h=0;h<m;++h){g=l[h]
if(!A.C(a3,p[o+h],a7,g,a5))return!1}for(h=0;h<i;++h){g=l[m+h]
if(!A.C(a3,k[h],a7,g,a5))return!1}f=s.c
e=r.c
d=f.length
c=e.length
for(b=0,a=0;a<c;a+=3){a0=e[a]
for(;;){if(b>=d)return!1
a1=f[b]
b+=3
if(a0<a1)return!1
a2=f[b-2]
if(a1<a0){if(a2)return!1
continue}g=e[a+1]
if(a2&&!g)return!1
g=f[b-1]
if(!A.C(a3,e[a+2],a7,g,a5))return!1
break}}while(b<d){if(f[b+1])return!1
b+=3}return!0},
kr(a,b,c,d,e){var s,r,q,p,o,n=b.x,m=d.x
while(n!==m){s=a.tR[n]
if(s==null)return!1
if(typeof s=="string"){n=s
continue}r=s[m]
if(r==null)return!1
q=r.length
p=q>0?new Array(q):v.typeUniverse.sEA
for(o=0;o<q;++o)p[o]=A.ed(a,b,r[o])
return A.hm(a,p,null,c,d.y,e)}return A.hm(a,b.y,null,c,d.y,e)},
hm(a,b,c,d,e,f){var s,r=b.length
for(s=0;s<r;++s)if(!A.C(a,b[s],d,e[s],f))return!1
return!0},
kw(a,b,c,d,e){var s,r=b.y,q=d.y,p=r.length
if(p!==q.length)return!1
if(b.x!==d.x)return!1
for(s=0;s<p;++s)if(!A.C(a,r[s],c,q[s],e))return!1
return!0},
bi(a){var s=a.w,r=!0
if(!(a===t.P||a===t.T))if(!A.aU(a))if(s!==6)r=s===7&&A.bi(a.x)
return r},
aU(a){var s=a.w
return s===2||s===3||s===4||s===5||a===t.V},
hl(a,b){var s,r,q=Object.keys(b),p=q.length
for(s=0;s<p;++s){r=q[s]
a[r]=b[r]}},
em(a){return a>0?new Array(a):v.typeUniverse.sEA},
a9:function a9(a,b){var _=this
_.a=a
_.b=b
_.r=_.f=_.d=_.c=null
_.w=0
_.as=_.Q=_.z=_.y=_.x=null},
dg:function dg(){this.c=this.b=this.a=null},
eb:function eb(a){this.a=a},
df:function df(){},
b9:function b9(a){this.a=a},
eM(a,b){return new A.bz(a.h("@<0>").L(b).h("bz<1,2>"))},
fB(a){var s,r
if(A.fd(a))return"{...}"
s=new A.K("")
try{r={}
B.b.k($.Z,a)
s.a+="{"
r.a=!0
a.a0(0,new A.dO(r,s))
s.a+="}"}finally{if(0>=$.Z.length)return A.a($.Z,-1)
$.Z.pop()}r=s.a
return r.charCodeAt(0)==0?r:r},
k:function k(){},
F:function F(){},
dO:function dO(a,b){this.a=a
this.b=b},
kD(a,b){var s,r,q,p=null
try{p=JSON.parse(a)}catch(r){s=A.cc(r)
q=A.z(String(s),null,null)
throw A.b(q)}q=A.eo(p)
return q},
eo(a){var s
if(a==null)return null
if(typeof a!="object")return a
if(!Array.isArray(a))return new A.dh(a,Object.create(null))
for(s=0;s<a.length;++s)a[s]=A.eo(a[s])
return a},
k4(a,b,c){var s,r,q,p,o=c-b
if(o<=4096)s=$.i8()
else s=new Uint8Array(o)
for(r=J.aT(a),q=0;q<o;++q){p=r.p(a,b+q)
if((p&255)!==p)p=255
s[q]=p}return s},
k3(a,b,c,d){var s=a?$.i7():$.i6()
if(s==null)return null
if(0===c&&d===b.length)return A.hk(s,b)
return A.hk(s,b.subarray(c,d))},
hk(a,b){var s,r
try{s=a.decode(b)
return s}catch(r){}return null},
fo(a,b,c,d,e,f){if(B.c.aG(f,4)!==0)throw A.b(A.z("Invalid base64 padding, padded length must be multiple of four, is "+f,a,c))
if(d+e!==f)throw A.b(A.z("Invalid base64 padding, '=' not at the end",a,b))
if(e>2)throw A.b(A.z("Invalid base64 padding, more than two '=' characters",a,b))},
k5(a){switch(a){case 65:return"Missing extension byte"
case 67:return"Unexpected extension byte"
case 69:return"Invalid UTF-8 byte"
case 71:return"Overlong encoding"
case 73:return"Out of unicode range"
case 75:return"Encoded surrogate"
case 77:return"Unfinished UTF-8 octet sequence"
default:return""}},
dh:function dh(a,b){this.a=a
this.b=b
this.c=null},
di:function di(a){this.a=a},
ek:function ek(){},
ej:function ej(){},
cf:function cf(){},
dm:function dm(){},
cg:function cg(a){this.a=a},
cj:function cj(){},
ck:function ck(){},
ag:function ag(){},
e9:function e9(a,b,c){this.a=a
this.b=b
this.$ti=c},
ah:function ah(){},
cp:function cp(){},
cz:function cz(){},
cA:function cA(a){this.a=a},
d9:function d9(){},
db:function db(){},
el:function el(a){this.b=0
this.c=a},
da:function da(a){this.a=a},
ei:function ei(a){this.a=a
this.b=16
this.c=0},
a3(a,b){var s=A.fH(a,b)
if(s!=null)return s
throw A.b(A.z(a,null,null))},
aw(a,b,c,d){var s,r=c?J.fz(a,d):J.fy(a,d)
if(a!==0&&b!=null)for(s=0;s<r.length;++s)r[s]=b
return r},
dN(a,b,c){var s,r=A.f([],c.h("v<0>"))
for(s=J.ac(a);s.m();)B.b.k(r,c.a(s.gn()))
if(b)return r
r.$flags=1
return r},
cE(a,b){var s,r
if(Array.isArray(a))return A.f(a.slice(0),b.h("v<0>"))
s=A.f([],b.h("v<0>"))
for(r=J.ac(a);r.m();)B.b.k(s,r.gn())
return s},
a8(a,b){var s=A.dN(a,!1,b)
s.$flags=3
return s},
fN(a,b,c){var s,r,q,p,o
A.Q(b,"start")
s=c==null
r=!s
if(r){q=c-b
if(q<0)throw A.b(A.B(c,b,null,"end",null))
if(q===0)return""}if(Array.isArray(a)){p=a
o=p.length
if(s)c=o
return A.fI(b>0||c<o?p.slice(b,c):p)}if(t.cr.b(a))return A.jj(a,b,c)
if(r)a=J.fm(a,c)
if(b>0)a=J.ds(a,b)
s=A.cE(a,t.S)
return A.fI(s)},
fM(a){return A.P(a)},
jj(a,b,c){var s=a.length
if(b>=s)return""
return A.jd(a,b,c==null||c>s?s:c)},
o(a,b){return new A.au(a,A.eJ(a,b,!0,!1,!1,""))},
eQ(a,b,c){var s=J.ac(b)
if(!s.m())return a
if(c.length===0){do a+=A.i(s.gn())
while(s.m())}else{a+=A.i(s.gn())
while(s.m())a=a+c+A.i(s.gn())}return a},
eV(){var s,r,q=A.ja()
if(q==null)throw A.b(A.X("'Uri.base' is not supported"))
s=$.fX
if(s!=null&&q===$.fW)return s
r=A.R(q)
$.fX=r
$.fW=q
return r},
k2(a,b,c,d){var s,r,q,p,o,n="0123456789ABCDEF"
if(c===B.f){s=$.i5()
s=s.b.test(b)}else s=!1
if(s)return b
r=B.H.af(b)
for(s=r.length,q=0,p="";q<s;++q){o=r[q]
if(o<128&&(u.v.charCodeAt(o)&a)!==0)p+=A.P(o)
else p=d&&o===32?p+"+":p+"%"+n[o>>>4&15]+n[o&15]}return p.charCodeAt(0)==0?p:p},
dD(a){if(typeof a=="number"||A.f3(a)||a==null)return J.bj(a)
if(typeof a=="string")return JSON.stringify(a)
return A.jb(a)},
ci(a){return new A.ch(a)},
L(a){return new A.a6(!1,null,null,a)},
ce(a,b,c){return new A.a6(!0,a,b,c)},
fn(a){return new A.a6(!1,null,a,"Must not be null")},
aX(a,b,c){return a==null?A.a4(A.fn(b)):a},
eN(a){var s=null
return new A.aj(s,s,!1,s,s,a)},
dR(a,b){return new A.aj(null,null,!0,a,b,"Value not in range")},
B(a,b,c,d,e){return new A.aj(b,c,!0,a,d,"Invalid value")},
fJ(a,b,c,d){if(a<b||a>c)throw A.b(A.B(a,b,c,d,null))
return a},
az(a,b,c){if(0>a||a>c)throw A.b(A.B(a,0,c,"start",null))
if(b!=null){if(a>b||b>c)throw A.b(A.B(b,a,c,"end",null))
return b}return c},
Q(a,b){if(a<0)throw A.b(A.B(a,0,null,b,null))
return a},
eI(a,b,c,d){return new A.bt(b,!0,a,d,"Index out of range")},
X(a){return new A.bW(a)},
fT(a){return new A.d4(a)},
d0(a){return new A.aM(a)},
S(a){return new A.cn(a)},
z(a,b,c){return new A.D(a,b,c)},
j2(a,b,c){var s,r
if(A.fd(a)){if(b==="("&&c===")")return"(...)"
return b+"..."+c}s=A.f([],t.s)
B.b.k($.Z,a)
try{A.kA(a,s)}finally{if(0>=$.Z.length)return A.a($.Z,-1)
$.Z.pop()}r=A.eQ(b,t.c.a(s),", ")+c
return r.charCodeAt(0)==0?r:r},
fx(a,b,c){var s,r
if(A.fd(a))return b+"..."+c
s=new A.K(b)
B.b.k($.Z,a)
try{r=s
r.a=A.eQ(r.a,a,", ")}finally{if(0>=$.Z.length)return A.a($.Z,-1)
$.Z.pop()}s.a+=c
r=s.a
return r.charCodeAt(0)==0?r:r},
kA(a,b){var s,r,q,p,o,n,m,l=a.gt(a),k=0,j=0
for(;;){if(!(k<80||j<3))break
if(!l.m())return
s=A.i(l.gn())
B.b.k(b,s)
k+=s.length+2;++j}if(!l.m()){if(j<=5)return
if(0>=b.length)return A.a(b,-1)
r=b.pop()
if(0>=b.length)return A.a(b,-1)
q=b.pop()}else{p=l.gn();++j
if(!l.m()){if(j<=4){B.b.k(b,A.i(p))
return}r=A.i(p)
if(0>=b.length)return A.a(b,-1)
q=b.pop()
k+=r.length+2}else{o=l.gn();++j
for(;l.m();p=o,o=n){n=l.gn();++j
if(j>100){for(;;){if(!(k>75&&j>3))break
if(0>=b.length)return A.a(b,-1)
k-=b.pop().length+2;--j}B.b.k(b,"...")
return}}q=A.i(p)
r=A.i(o)
k+=r.length+q.length+4}}if(j>b.length+2){k+=5
m="..."}else m=null
for(;;){if(!(k>80&&b.length>3))break
if(0>=b.length)return A.a(b,-1)
k-=b.pop().length+2
if(m==null){k+=5
m="..."}}if(m!=null)B.b.k(b,m)
B.b.k(b,q)
B.b.k(b,r)},
j8(a,b,c,d,e){return new A.aG(a,b.h("@<0>").L(c).L(d).L(e).h("aG<1,2,3,4>"))},
fD(a,b,c){var s
if(B.j===c){s=J.aW(a)
b=J.aW(b)
return A.fO(A.d2(A.d2($.fj(),s),b))}s=J.aW(a)
b=J.aW(b)
c=c.gD(c)
c=A.fO(A.d2(A.d2(A.d2($.fj(),s),b),c))
return c},
fV(a){var s,r=null,q=new A.K(""),p=A.f([-1],t.t)
A.jv(r,r,r,q,p)
B.b.k(p,q.a.length)
q.a+=","
A.ju(256,B.x.cg(a),q)
s=q.a
return new A.d6(s.charCodeAt(0)==0?s:s,p,r).gac()},
R(a5){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c,b,a,a0,a1,a2,a3=null,a4=a5.length
if(a4>=5){if(4>=a4)return A.a(a5,4)
s=((a5.charCodeAt(4)^58)*3|a5.charCodeAt(0)^100|a5.charCodeAt(1)^97|a5.charCodeAt(2)^116|a5.charCodeAt(3)^97)>>>0
if(s===0)return A.fU(a4<a4?B.a.j(a5,0,a4):a5,5,a3).gac()
else if(s===32)return A.fU(B.a.j(a5,5,a4),0,a3).gac()}r=A.aw(8,0,!1,t.S)
B.b.v(r,0,0)
B.b.v(r,1,-1)
B.b.v(r,2,-1)
B.b.v(r,7,-1)
B.b.v(r,3,0)
B.b.v(r,4,0)
B.b.v(r,5,a4)
B.b.v(r,6,a4)
if(A.hy(a5,0,a4,0,r)>=14)B.b.v(r,7,a4)
q=r[1]
if(q>=0)if(A.hy(a5,0,q,20,r)===20)r[7]=q
p=r[2]+1
o=r[3]
n=r[4]
m=r[5]
l=r[6]
if(l<m)m=l
if(n<p)n=m
else if(n<=q)n=q+1
if(o<p)o=n
k=r[7]<0
j=a3
if(k){k=!1
if(!(p>q+3)){i=o>0
if(!(i&&o+1===n)){if(!B.a.A(a5,"\\",n))if(p>0)h=B.a.A(a5,"\\",p-1)||B.a.A(a5,"\\",p-2)
else h=!1
else h=!0
if(!h){if(!(m<a4&&m===n+2&&B.a.A(a5,"..",n)))h=m>n+2&&B.a.A(a5,"/..",m-3)
else h=!0
if(!h)if(q===4){if(B.a.A(a5,"file",0)){if(p<=0){if(!B.a.A(a5,"/",n)){g="file:///"
s=3}else{g="file://"
s=2}a5=g+B.a.j(a5,n,a4)
m+=s
l+=s
a4=a5.length
p=7
o=7
n=7}else if(n===m){++l
f=m+1
a5=B.a.U(a5,n,m,"/");++a4
m=f}j="file"}else if(B.a.A(a5,"http",0)){if(i&&o+3===n&&B.a.A(a5,"80",o+1)){l-=3
e=n-3
m-=3
a5=B.a.U(a5,o,n,"")
a4-=3
n=e}j="http"}}else if(q===5&&B.a.A(a5,"https",0)){if(i&&o+4===n&&B.a.A(a5,"443",o+1)){l-=4
e=n-4
m-=4
a5=B.a.U(a5,o,n,"")
a4-=3
n=e}j="https"}k=!h}}}}if(k)return new A.a1(a4<a5.length?B.a.j(a5,0,a4):a5,q,p,o,n,m,l,j)
if(j==null)if(q>0)j=A.eh(a5,0,q)
else{if(q===0)A.ba(a5,0,"Invalid empty scheme")
j=""}d=a3
if(p>0){c=q+3
b=c<p?A.hg(a5,c,p-1):""
a=A.hd(a5,p,o,!1)
i=o+1
if(i<n){a0=A.fH(B.a.j(a5,i,n),a3)
d=A.eg(a0==null?A.a4(A.z("Invalid port",a5,i)):a0,j)}}else{a=a3
b=""}a1=A.he(a5,n,m,a3,j,a!=null)
a2=m<l?A.hf(a5,m+1,l,a3):a3
return A.c8(j,b,a,d,a1,a2,l<a4?A.hc(a5,l+1,a4):a3)},
jz(a){A.m(a)
return A.f0(a,0,a.length,B.f,!1)},
d7(a,b,c){throw A.b(A.z("Illegal IPv4 address, "+a,b,c))},
jw(a,b,c,d,e){var s,r,q,p,o,n,m,l,k,j="invalid character"
for(s=a.length,r=b,q=r,p=0,o=0;;){if(q>=c)n=0
else{if(!(q>=0&&q<s))return A.a(a,q)
n=a.charCodeAt(q)}m=n^48
if(m<=9){if(o!==0||q===r){o=o*10+m
if(o<=255){++q
continue}A.d7("each part must be in the range 0..255",a,r)}A.d7("parts must not have leading zeros",a,r)}if(q===r){if(q===c)break
A.d7(j,a,q)}l=p+1
k=e+p
d.$flags&2&&A.H(d)
if(!(k<16))return A.a(d,k)
d[k]=o
if(n===46){if(l<4){++q
p=l
r=q
o=0
continue}break}if(q===c){if(l===4)return
break}A.d7(j,a,q)
p=l}A.d7("IPv4 address should contain exactly 4 parts",a,q)},
jx(a,b,c){var s
if(b===c)throw A.b(A.z("Empty IP address",a,b))
if(!(b>=0&&b<a.length))return A.a(a,b)
if(a.charCodeAt(b)===118){s=A.jy(a,b,c)
if(s!=null)throw A.b(s)
return!1}A.fY(a,b,c)
return!0},
jy(a,b,c){var s,r,q,p,o,n="Missing hex-digit in IPvFuture address",m=u.v;++b
for(s=a.length,r=b;;r=q){if(r<c){q=r+1
if(!(r>=0&&r<s))return A.a(a,r)
p=a.charCodeAt(r)
if((p^48)<=9)continue
o=p|32
if(o>=97&&o<=102)continue
if(p===46){if(q-1===b)return new A.D(n,a,q)
r=q
break}return new A.D("Unexpected character",a,q-1)}if(r-1===b)return new A.D(n,a,r)
return new A.D("Missing '.' in IPvFuture address",a,r)}if(r===c)return new A.D("Missing address in IPvFuture address, host, cursor",null,null)
for(;;){if(!(r>=0&&r<s))return A.a(a,r)
p=a.charCodeAt(r)
if(!(p<128))return A.a(m,p)
if((m.charCodeAt(p)&16)!==0){++r
if(r<c)continue
return null}return new A.D("Invalid IPvFuture address character",a,r)}},
fY(a2,a3,a4){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c,b,a,a0="an address must contain at most 8 parts",a1=new A.e7(a2)
if(a4-a3<2)a1.$2("address is too short",null)
s=new Uint8Array(16)
r=a2.length
if(!(a3>=0&&a3<r))return A.a(a2,a3)
q=-1
p=0
if(a2.charCodeAt(a3)===58){o=a3+1
if(!(o<r))return A.a(a2,o)
if(a2.charCodeAt(o)===58){n=a3+2
m=n
q=0
p=1}else{a1.$2("invalid start colon",a3)
n=a3
m=n}}else{n=a3
m=n}for(l=0,k=!0;;){if(n>=a4)j=0
else{if(!(n<r))return A.a(a2,n)
j=a2.charCodeAt(n)}A:{i=j^48
if(i<=9)h=i
else{g=j|32
if(g>=97&&g<=102)h=g-87
else break A
k=!1}if(n<m+4){l=l*16+h;++n
continue}a1.$2("an IPv6 part can contain a maximum of 4 hex digits",m)}if(n>m){if(j===46){if(k){if(p<=6){A.jw(a2,m,a4,s,p*2)
p+=2
n=a4
break}a1.$2(a0,m)}break}o=p*2
f=B.c.ao(l,8)
if(!(o<16))return A.a(s,o)
s[o]=f;++o
if(!(o<16))return A.a(s,o)
s[o]=l&255;++p
if(j===58){if(p<8){++n
m=n
l=0
k=!0
continue}a1.$2(a0,n)}break}if(j===58){if(q<0){e=p+1;++n
q=p
p=e
m=n
continue}a1.$2("only one wildcard `::` is allowed",n)}if(q!==p-1)a1.$2("missing part",n)
break}if(n<a4)a1.$2("invalid character",n)
if(p<8){if(q<0)a1.$2("an address without a wildcard must contain exactly 8 parts",a4)
d=q+1
c=p-d
if(c>0){b=d*2
a=16-c*2
B.u.a6(s,a,16,s,b)
B.u.ci(s,b,a,0)}}return s},
c8(a,b,c,d,e,f,g){return new A.c7(a,b,c,d,e,f,g)},
E(a,b,c,d){var s,r,q,p,o,n,m,l,k=null
d=d==null?"":A.eh(d,0,d.length)
s=A.hg(k,0,0)
a=A.hd(a,0,a==null?0:a.length,!1)
r=A.hf(k,0,0,k)
q=A.hc(k,0,0)
p=A.eg(k,d)
o=d==="file"
if(a==null)n=s.length!==0||p!=null||o
else n=!1
if(n)a=""
n=a==null
m=!n
b=A.he(b,0,b==null?0:b.length,c,d,m)
l=d.length===0
if(l&&n&&!B.a.q(b,"/"))b=A.f_(b,!l||m)
else b=A.aR(b)
return A.c8(d,s,n&&B.a.q(b,"//")?"":a,p,b,r,q)},
h9(a){if(a==="http")return 80
if(a==="https")return 443
return 0},
ba(a,b,c){throw A.b(A.z(c,a,b))},
h8(a,b){return b?A.jZ(a,!1):A.jY(a,!1)},
jU(a,b){var s,r,q
for(s=a.length,r=0;r<s;++r){q=a[r]
if(B.a.u(q,"/")){s=A.X("Illegal path character "+q)
throw A.b(s)}}},
ee(a,b,c){var s,r,q
for(s=A.al(a,c,null,A.w(a).c),r=s.$ti,s=new A.U(s,s.gl(0),r.h("U<I.E>")),r=r.h("I.E");s.m();){q=s.d
if(q==null)q=r.a(q)
if(B.a.u(q,A.o('["*/:<>?\\\\|]',!1)))if(b)throw A.b(A.L("Illegal character in path"))
else throw A.b(A.X("Illegal character in path: "+q))}},
jV(a,b){var s,r="Illegal drive letter "
if(!(65<=a&&a<=90))s=97<=a&&a<=122
else s=!0
if(s)return
if(b)throw A.b(A.L(r+A.fM(a)))
else throw A.b(A.X(r+A.fM(a)))},
jY(a,b){var s=null,r=A.f(a.split("/"),t.s)
if(B.a.q(a,"/"))return A.E(s,s,r,"file")
else return A.E(s,s,r,s)},
jZ(a,b){var s,r,q,p,o,n="\\",m=null,l="file"
if(B.a.q(a,"\\\\?\\"))if(B.a.A(a,"UNC\\",4))a=B.a.U(a,0,7,n)
else{a=B.a.B(a,4)
s=a.length
r=!0
if(s>=3){if(1>=s)return A.a(a,1)
if(a.charCodeAt(1)===58){if(2>=s)return A.a(a,2)
s=a.charCodeAt(2)!==92}else s=r}else s=r
if(s)throw A.b(A.ce(a,"path","Windows paths with \\\\?\\ prefix must be absolute"))}else a=A.a0(a,"/",n)
s=a.length
if(s>1&&a.charCodeAt(1)===58){if(0>=s)return A.a(a,0)
A.jV(a.charCodeAt(0),!0)
if(s!==2){if(2>=s)return A.a(a,2)
s=a.charCodeAt(2)!==92}else s=!0
if(s)throw A.b(A.ce(a,"path","Windows paths with drive letter must be absolute"))
q=A.f(a.split(n),t.s)
A.ee(q,!0,1)
return A.E(m,m,q,l)}if(B.a.q(a,n))if(B.a.A(a,n,1)){p=B.a.a2(a,n,2)
s=p<0
o=s?B.a.B(a,2):B.a.j(a,2,p)
q=A.f((s?"":B.a.B(a,p+1)).split(n),t.s)
A.ee(q,!0,0)
return A.E(o,m,q,l)}else{q=A.f(a.split(n),t.s)
A.ee(q,!0,0)
return A.E(m,m,q,l)}else{q=A.f(a.split(n),t.s)
A.ee(q,!0,0)
return A.E(m,m,q,m)}},
eg(a,b){if(a!=null&&a===A.h9(b))return null
return a},
hd(a,b,c,d){var s,r,q,p,o,n,m,l,k
if(a==null)return null
if(b===c)return""
s=a.length
if(!(b>=0&&b<s))return A.a(a,b)
if(a.charCodeAt(b)===91){r=c-1
if(!(r>=0&&r<s))return A.a(a,r)
if(a.charCodeAt(r)!==93)A.ba(a,b,"Missing end `]` to match `[` in host")
q=b+1
if(!(q<s))return A.a(a,q)
p=""
if(a.charCodeAt(q)!==118){o=A.jW(a,q,r)
if(o<r){n=o+1
p=A.hj(a,B.a.A(a,"25",n)?o+3:n,r,"%25")}}else o=r
m=A.jx(a,q,o)
l=B.a.j(a,q,o)
return"["+(m?l.toLowerCase():l)+p+"]"}for(k=b;k<c;++k){if(!(k<s))return A.a(a,k)
if(a.charCodeAt(k)===58){o=B.a.a2(a,"%",b)
o=o>=b&&o<c?o:c
if(o<c){n=o+1
p=A.hj(a,B.a.A(a,"25",n)?o+3:n,c,"%25")}else p=""
A.fY(a,b,o)
return"["+B.a.j(a,b,o)+p+"]"}}return A.k0(a,b,c)},
jW(a,b,c){var s=B.a.a2(a,"%",b)
return s>=b&&s<c?s:c},
hj(a,b,c,d){var s,r,q,p,o,n,m,l,k,j,i,h=d!==""?new A.K(d):null
for(s=a.length,r=b,q=r,p=!0;r<c;){if(!(r>=0&&r<s))return A.a(a,r)
o=a.charCodeAt(r)
if(o===37){n=A.eZ(a,r,!0)
m=n==null
if(m&&p){r+=3
continue}if(h==null)h=new A.K("")
l=h.a+=B.a.j(a,q,r)
if(m)n=B.a.j(a,r,r+3)
else if(n==="%")A.ba(a,r,"ZoneID should not contain % anymore")
h.a=l+n
r+=3
q=r
p=!0}else if(o<127&&(u.v.charCodeAt(o)&1)!==0){if(p&&65<=o&&90>=o){if(h==null)h=new A.K("")
if(q<r){h.a+=B.a.j(a,q,r)
q=r}p=!1}++r}else{k=1
if((o&64512)===55296&&r+1<c){m=r+1
if(!(m<s))return A.a(a,m)
j=a.charCodeAt(m)
if((j&64512)===56320){o=65536+((o&1023)<<10)+(j&1023)
k=2}}i=B.a.j(a,q,r)
if(h==null){h=new A.K("")
m=h}else m=h
m.a+=i
l=A.eY(o)
m.a+=l
r+=k
q=r}}if(h==null)return B.a.j(a,b,c)
if(q<c){i=B.a.j(a,q,c)
h.a+=i}s=h.a
return s.charCodeAt(0)==0?s:s},
k0(a,b,c){var s,r,q,p,o,n,m,l,k,j,i,h,g=u.v
for(s=a.length,r=b,q=r,p=null,o=!0;r<c;){if(!(r>=0&&r<s))return A.a(a,r)
n=a.charCodeAt(r)
if(n===37){m=A.eZ(a,r,!0)
l=m==null
if(l&&o){r+=3
continue}if(p==null)p=new A.K("")
k=B.a.j(a,q,r)
if(!o)k=k.toLowerCase()
j=p.a+=k
i=3
if(l)m=B.a.j(a,r,r+3)
else if(m==="%"){m="%25"
i=1}p.a=j+m
r+=i
q=r
o=!0}else if(n<127&&(g.charCodeAt(n)&32)!==0){if(o&&65<=n&&90>=n){if(p==null)p=new A.K("")
if(q<r){p.a+=B.a.j(a,q,r)
q=r}o=!1}++r}else if(n<=93&&(g.charCodeAt(n)&1024)!==0)A.ba(a,r,"Invalid character")
else{i=1
if((n&64512)===55296&&r+1<c){l=r+1
if(!(l<s))return A.a(a,l)
h=a.charCodeAt(l)
if((h&64512)===56320){n=65536+((n&1023)<<10)+(h&1023)
i=2}}k=B.a.j(a,q,r)
if(!o)k=k.toLowerCase()
if(p==null){p=new A.K("")
l=p}else l=p
l.a+=k
j=A.eY(n)
l.a+=j
r+=i
q=r}}if(p==null)return B.a.j(a,b,c)
if(q<c){k=B.a.j(a,q,c)
if(!o)k=k.toLowerCase()
p.a+=k}s=p.a
return s.charCodeAt(0)==0?s:s},
eh(a,b,c){var s,r,q,p
if(b===c)return""
s=a.length
if(!(b<s))return A.a(a,b)
if(!A.hb(a.charCodeAt(b)))A.ba(a,b,"Scheme not starting with alphabetic character")
for(r=b,q=!1;r<c;++r){if(!(r<s))return A.a(a,r)
p=a.charCodeAt(r)
if(!(p<128&&(u.v.charCodeAt(p)&8)!==0))A.ba(a,r,"Illegal scheme character")
if(65<=p&&p<=90)q=!0}a=B.a.j(a,b,c)
return A.jT(q?a.toLowerCase():a)},
jT(a){if(a==="http")return"http"
if(a==="file")return"file"
if(a==="https")return"https"
if(a==="package")return"package"
return a},
hg(a,b,c){if(a==null)return""
return A.c9(a,b,c,16,!1,!1)},
he(a,b,c,d,e,f){var s,r,q=e==="file",p=q||f
if(a==null){if(d==null)return q?"/":""
s=A.w(d)
r=new A.y(d,s.h("e(1)").a(new A.ef()),s.h("y<1,e>")).Z(0,"/")}else if(d!=null)throw A.b(A.L("Both path and pathSegments specified"))
else r=A.c9(a,b,c,128,!0,!0)
if(r.length===0){if(q)return"/"}else if(p&&!B.a.q(r,"/"))r="/"+r
return A.k_(r,e,f)},
k_(a,b,c){var s=b.length===0
if(s&&!c&&!B.a.q(a,"/")&&!B.a.q(a,"\\"))return A.f_(a,!s||c)
return A.aR(a)},
hf(a,b,c,d){if(a!=null)return A.c9(a,b,c,256,!0,!1)
return null},
hc(a,b,c){if(a==null)return null
return A.c9(a,b,c,256,!0,!1)},
eZ(a,b,c){var s,r,q,p,o,n,m=u.v,l=b+2,k=a.length
if(l>=k)return"%"
s=b+1
if(!(s>=0&&s<k))return A.a(a,s)
r=a.charCodeAt(s)
if(!(l>=0))return A.a(a,l)
q=a.charCodeAt(l)
p=A.ew(r)
o=A.ew(q)
if(p<0||o<0)return"%"
n=p*16+o
if(n<127){if(!(n>=0))return A.a(m,n)
l=(m.charCodeAt(n)&1)!==0}else l=!1
if(l)return A.P(c&&65<=n&&90>=n?(n|32)>>>0:n)
if(r>=97||q>=97)return B.a.j(a,b,b+3).toUpperCase()
return null},
eY(a){var s,r,q,p,o,n,m,l,k="0123456789ABCDEF"
if(a<=127){s=new Uint8Array(3)
s[0]=37
r=a>>>4
if(!(r<16))return A.a(k,r)
s[1]=k.charCodeAt(r)
s[2]=k.charCodeAt(a&15)}else{if(a>2047)if(a>65535){q=240
p=4}else{q=224
p=3}else{q=192
p=2}r=3*p
s=new Uint8Array(r)
for(o=0;--p,p>=0;q=128){n=B.c.c5(a,6*p)&63|q
if(!(o<r))return A.a(s,o)
s[o]=37
m=o+1
l=n>>>4
if(!(l<16))return A.a(k,l)
if(!(m<r))return A.a(s,m)
s[m]=k.charCodeAt(l)
l=o+2
if(!(l<r))return A.a(s,l)
s[l]=k.charCodeAt(n&15)
o+=3}}return A.fN(s,0,null)},
c9(a,b,c,d,e,f){var s=A.hi(a,b,c,d,e,f)
return s==null?B.a.j(a,b,c):s},
hi(a,b,c,d,e,f){var s,r,q,p,o,n,m,l,k,j,i=null,h=u.v
for(s=!e,r=a.length,q=b,p=q,o=i;q<c;){if(!(q>=0&&q<r))return A.a(a,q)
n=a.charCodeAt(q)
if(n<127&&(h.charCodeAt(n)&d)!==0)++q
else{m=1
if(n===37){l=A.eZ(a,q,!1)
if(l==null){q+=3
continue}if("%"===l)l="%25"
else m=3}else if(n===92&&f)l="/"
else if(s&&n<=93&&(h.charCodeAt(n)&1024)!==0){A.ba(a,q,"Invalid character")
m=i
l=m}else{if((n&64512)===55296){k=q+1
if(k<c){if(!(k<r))return A.a(a,k)
j=a.charCodeAt(k)
if((j&64512)===56320){n=65536+((n&1023)<<10)+(j&1023)
m=2}}}l=A.eY(n)}if(o==null){o=new A.K("")
k=o}else k=o
k.a=(k.a+=B.a.j(a,p,q))+l
if(typeof m!=="number")return A.kY(m)
q+=m
p=q}}if(o==null)return i
if(p<c){s=B.a.j(a,p,c)
o.a+=s}s=o.a
return s.charCodeAt(0)==0?s:s},
hh(a){if(B.a.q(a,"."))return!0
return B.a.ag(a,"/.")!==-1},
aR(a){var s,r,q,p,o,n,m
if(!A.hh(a))return a
s=A.f([],t.s)
for(r=a.split("/"),q=r.length,p=!1,o=0;o<q;++o){n=r[o]
if(n===".."){m=s.length
if(m!==0){if(0>=m)return A.a(s,-1)
s.pop()
if(s.length===0)B.b.k(s,"")}p=!0}else{p="."===n
if(!p)B.b.k(s,n)}}if(p)B.b.k(s,"")
return B.b.Z(s,"/")},
f_(a,b){var s,r,q,p,o,n
if(!A.hh(a))return!b?A.ha(a):a
s=A.f([],t.s)
for(r=a.split("/"),q=r.length,p=!1,o=0;o<q;++o){n=r[o]
if(".."===n){if(s.length!==0&&B.b.gH(s)!==".."){if(0>=s.length)return A.a(s,-1)
s.pop()}else B.b.k(s,"..")
p=!0}else{p="."===n
if(!p)B.b.k(s,n.length===0&&s.length===0?"./":n)}}if(s.length===0)return"./"
if(p)B.b.k(s,"")
if(!b){if(0>=s.length)return A.a(s,0)
B.b.v(s,0,A.ha(s[0]))}return B.b.Z(s,"/")},
ha(a){var s,r,q,p=u.v,o=a.length
if(o>=2&&A.hb(a.charCodeAt(0)))for(s=1;s<o;++s){r=a.charCodeAt(s)
if(r===58)return B.a.j(a,0,s)+"%3A"+B.a.B(a,s+1)
if(r<=127){if(!(r<128))return A.a(p,r)
q=(p.charCodeAt(r)&8)===0}else q=!0
if(q)break}return a},
k1(a,b){if(a.cm("package")&&a.c==null)return A.hz(b,0,b.length)
return-1},
jX(a,b){var s,r,q,p,o
for(s=a.length,r=0,q=0;q<2;++q){p=b+q
if(!(p<s))return A.a(a,p)
o=a.charCodeAt(p)
if(48<=o&&o<=57)r=r*16+o-48
else{o|=32
if(97<=o&&o<=102)r=r*16+o-87
else throw A.b(A.L("Invalid URL encoding"))}}return r},
f0(a,b,c,d,e){var s,r,q,p,o=a.length,n=b
for(;;){if(!(n<c)){s=!0
break}if(!(n<o))return A.a(a,n)
r=a.charCodeAt(n)
if(r<=127)q=r===37
else q=!0
if(q){s=!1
break}++n}if(s)if(B.f===d)return B.a.j(a,b,c)
else p=new A.bl(B.a.j(a,b,c))
else{p=A.f([],t.t)
for(n=b;n<c;++n){if(!(n<o))return A.a(a,n)
r=a.charCodeAt(n)
if(r>127)throw A.b(A.L("Illegal percent encoding in URI"))
if(r===37){if(n+3>o)throw A.b(A.L("Truncated URI"))
B.b.k(p,A.jX(a,n+1))
n+=2}else B.b.k(p,r)}}t.L.a(p)
return B.a5.af(p)},
hb(a){var s=a|32
return 97<=s&&s<=122},
jv(a,b,c,d,e){d.a=d.a},
fU(a,b,c){var s,r,q,p,o,n,m,l,k="Invalid MIME type",j=A.f([b-1],t.t)
for(s=a.length,r=b,q=-1,p=null;r<s;++r){p=a.charCodeAt(r)
if(p===44||p===59)break
if(p===47){if(q<0){q=r
continue}throw A.b(A.z(k,a,r))}}if(q<0&&r>b)throw A.b(A.z(k,a,r))
while(p!==44){B.b.k(j,r);++r
for(o=-1;r<s;++r){if(!(r>=0))return A.a(a,r)
p=a.charCodeAt(r)
if(p===61){if(o<0)o=r}else if(p===59||p===44)break}if(o>=0)B.b.k(j,o)
else{n=B.b.gH(j)
if(p!==44||r!==n+7||!B.a.A(a,"base64",n+1))throw A.b(A.z("Expecting '='",a,r))
break}}B.b.k(j,r)
m=r+1
if((j.length&1)===1)a=B.y.cn(a,m,s)
else{l=A.hi(a,m,s,256,!0,!1)
if(l!=null)a=B.a.U(a,m,s,l)}return new A.d6(a,j,c)},
ju(a,b,c){var s,r,q,p,o,n="0123456789ABCDEF"
for(s=b.length,r=0,q=0;q<s;++q){p=b[q]
r|=p
if(p<128&&(u.v.charCodeAt(p)&a)!==0){o=A.P(p)
c.a+=o}else{o=A.P(37)
c.a+=o
o=p>>>4
if(!(o<16))return A.a(n,o)
o=A.P(n.charCodeAt(o))
c.a+=o
o=A.P(n.charCodeAt(p&15))
c.a+=o}}if((r&4294967040)!==0)for(q=0;q<s;++q){p=b[q]
if(p>255)throw A.b(A.ce(p,"non-byte value",null))}},
hy(a,b,c,d,e){var s,r,q,p,o,n='\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xe1\xe1\x01\xe1\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xe3\xe1\xe1\x01\xe1\x01\xe1\xcd\x01\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x0e\x03\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01"\x01\xe1\x01\xe1\xac\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xe1\xe1\x01\xe1\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xea\xe1\xe1\x01\xe1\x01\xe1\xcd\x01\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\n\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01"\x01\xe1\x01\xe1\xac\xeb\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\xeb\xeb\xeb\x8b\xeb\xeb\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\xeb\x83\xeb\xeb\x8b\xeb\x8b\xeb\xcd\x8b\xeb\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x92\x83\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\x8b\xeb\x8b\xeb\x8b\xeb\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xebD\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\x12D\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xe5\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\xe5\xe5\xe5\x05\xe5D\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe8\x8a\xe5\xe5\x05\xe5\x05\xe5\xcd\x05\xe5\x05\x05\x05\x05\x05\x05\x05\x05\x05\x8a\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05f\x05\xe5\x05\xe5\xac\xe5\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05\xe5\xe5\xe5\x05\xe5D\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\xe5\x8a\xe5\xe5\x05\xe5\x05\xe5\xcd\x05\xe5\x05\x05\x05\x05\x05\x05\x05\x05\x05\x8a\x05\x05\x05\x05\x05\x05\x05\x05\x05\x05f\x05\xe5\x05\xe5\xac\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7D\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\x8a\xe7\xe7\xe7\xe7\xe7\xe7\xcd\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\x8a\xe7\x07\x07\x07\x07\x07\x07\x07\x07\x07\xe7\xe7\xe7\xe7\xe7\xac\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7D\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\x8a\xe7\xe7\xe7\xe7\xe7\xe7\xcd\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\xe7\x8a\x07\x07\x07\x07\x07\x07\x07\x07\x07\x07\xe7\xe7\xe7\xe7\xe7\xac\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\x05\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xea\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\x10\xea\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xea\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\x12\n\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xea\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\v\n\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xec\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\xec\xec\xec\f\xec\xec\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\f\xec\xec\xec\xec\f\xec\f\xec\xcd\f\xec\f\f\f\f\f\f\f\f\f\xec\f\f\f\f\f\f\f\f\f\f\xec\f\xec\f\xec\f\xed\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\xed\xed\xed\r\xed\xed\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\r\xed\xed\xed\xed\r\xed\r\xed\xed\r\xed\r\r\r\r\r\r\r\r\r\xed\r\r\r\r\r\r\r\r\r\r\xed\r\xed\r\xed\r\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xe1\xe1\x01\xe1\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xea\xe1\xe1\x01\xe1\x01\xe1\xcd\x01\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x0f\xea\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01"\x01\xe1\x01\xe1\xac\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xe1\xe1\x01\xe1\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xe1\xe9\xe1\xe1\x01\xe1\x01\xe1\xcd\x01\xe1\x01\x01\x01\x01\x01\x01\x01\x01\x01\t\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01"\x01\xe1\x01\xe1\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xea\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\x11\xea\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xe9\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\v\t\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xea\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\x13\xea\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xeb\xeb\v\xeb\xeb\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\v\xeb\xea\xeb\xeb\v\xeb\v\xeb\xcd\v\xeb\v\v\v\v\v\v\v\v\v\xea\v\v\v\v\v\v\v\v\v\v\xeb\v\xeb\v\xeb\xac\xf5\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\xf5\x15\xf5\x15\x15\xf5\x15\x15\x15\x15\x15\x15\x15\x15\x15\x15\xf5\xf5\xf5\xf5\xf5\xf5'
for(s=a.length,r=b;r<c;++r){if(!(r<s))return A.a(a,r)
q=a.charCodeAt(r)^96
if(q>95)q=31
p=d*96+q
if(!(p<2112))return A.a(n,p)
o=n.charCodeAt(p)
d=o&31
B.b.v(e,o>>>5,r)}return d},
h2(a){if(a.b===7&&B.a.q(a.a,"package")&&a.c<=0)return A.hz(a.a,a.e,a.f)
return-1},
hz(a,b,c){var s,r,q,p
for(s=a.length,r=b,q=0;r<c;++r){if(!(r>=0&&r<s))return A.a(a,r)
p=a.charCodeAt(r)
if(p===47)return q!==0?r:-1
if(p===37||p===58)return-1
q|=p^46}return-1},
ke(a,b,c){var s,r,q,p,o,n,m,l
for(s=a.length,r=b.length,q=0,p=0;p<s;++p){o=c+p
if(!(o<r))return A.a(b,o)
n=b.charCodeAt(o)
m=a.charCodeAt(p)^n
if(m!==0){if(m===32){l=n|m
if(97<=l&&l<=122){q=32
continue}}return-1}}return q},
x:function x(){},
ch:function ch(a){this.a=a},
bV:function bV(){},
a6:function a6(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.d=d},
aj:function aj(a,b,c,d,e,f){var _=this
_.e=a
_.f=b
_.a=c
_.b=d
_.c=e
_.d=f},
bt:function bt(a,b,c,d,e){var _=this
_.f=a
_.a=b
_.b=c
_.c=d
_.d=e},
bW:function bW(a){this.a=a},
d4:function d4(a){this.a=a},
aM:function aM(a){this.a=a},
cn:function cn(a){this.a=a},
cQ:function cQ(){},
bR:function bR(){},
D:function D(a,b,c){this.a=a
this.b=b
this.c=c},
d:function d(){},
bH:function bH(){},
r:function r(){},
K:function K(a){this.a=a},
e7:function e7(a){this.a=a},
c7:function c7(a,b,c,d,e,f,g){var _=this
_.a=a
_.b=b
_.c=c
_.d=d
_.e=e
_.f=f
_.r=g
_.y=_.x=_.w=$},
ef:function ef(){},
d6:function d6(a,b,c){this.a=a
this.b=b
this.c=c},
a1:function a1(a,b,c,d,e,f,g,h){var _=this
_.a=a
_.b=b
_.c=c
_.d=d
_.e=e
_.f=f
_.r=g
_.w=h
_.x=null},
de:function de(a,b,c,d,e,f,g){var _=this
_.a=a
_.b=b
_.c=c
_.d=d
_.e=e
_.f=f
_.r=g
_.y=_.x=_.w=$},
eH(a){return new A.co(a,".")},
f4(a){return a},
hB(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q){var s=A.f([b],t.s)
B.b.k(s,c)
return s},
co:function co(a,b){this.a=a
this.b=b},
dB:function dB(){},
dC:function dC(){},
b6:function b6(a){this.a=a},
b7:function b7(a){this.a=a},
aL(a,b){var s,r,q,p,o,n,m,l=b.bH(a)
b.P(a)
if(l!=null)a=B.a.B(a,l.length)
s=t.s
r=A.f([],s)
q=A.f([],s)
s=a.length
if(s!==0){if(0>=s)return A.a(a,0)
p=b.C(a.charCodeAt(0))}else p=!1
if(p){if(0>=s)return A.a(a,0)
B.b.k(q,a[0])
o=1}else{B.b.k(q,"")
o=0}for(n=o;n<s;++n){m=a.charCodeAt(n)
if(b.C(m)){B.b.k(r,B.a.j(a,o,n))
B.b.k(q,a[n])
o=n+1}if(b===$.ar())p=m===63||m===35
else p=!1
if(p)break}if(o<s){B.b.k(r,B.a.B(a,o))
B.b.k(q,"")}return new A.dP(b,l,r,q)},
dP:function dP(a,b,c,d){var _=this
_.a=a
_.b=b
_.d=c
_.e=d},
fE(a){return new A.bJ(a)},
bJ:function bJ(a){this.a=a},
jk(){if(A.eV().gI()!=="file")return $.ar()
if(!B.a.aQ(A.eV().gR(),"/"))return $.ar()
if(A.E(null,"a/b",null,null).b8()==="a\\b")return $.cd()
return $.hU()},
b0:function b0(){},
dX:function dX(){},
cS:function cS(a,b,c){this.d=a
this.e=b
this.f=c},
d8:function d8(a,b,c,d){var _=this
_.d=a
_.e=b
_.f=c
_.r=d},
dc:function dc(a,b,c,d){var _=this
_.d=a
_.e=b
_.f=c
_.r=d},
e8:function e8(){},
hK(a,b,c){var s,r,q="sections"
if(!J.as(a.p(0,"version"),3))throw A.b(A.L("unexpected source map version: "+A.i(a.p(0,"version"))+". Only version 3 is supported."))
if(a.O(q)){if(a.O("mappings")||a.O("sources")||a.O("names"))throw A.b(B.J)
s=t.j.a(a.p(0,q))
r=t.t
r=new A.cG(A.f([],r),A.f([],r),A.f([],t.o))
r.bM(s,c,b)
return r}return A.jg(a.br(0,t.N,t.z),b)},
jg(a,b){var s,r=a.a,q=a.$ti.h("4?"),p=A.dn(q.a(r.p(0,"file"))),o=t.j,n=t.N,m=A.dN(o.a(q.a(r.p(0,"sources"))),!0,n),l=t.O.a(q.a(r.p(0,"names")))
l=A.dN(l==null?[]:l,!0,n)
o=A.aw(J.a5(o.a(q.a(r.p(0,"sources")))),null,!1,t.w)
r=A.dn(q.a(r.p(0,"sourceRoot")))
q=A.f([],t.l)
s=typeof b=="string"?A.R(b):t.I.a(b)
n=new A.bM(m,l,o,q,p,r,s,A.eM(n,t.z))
n.bN(a,b)
return n},
ay:function ay(){},
cG:function cG(a,b,c){this.a=a
this.b=b
this.c=c},
cF:function cF(a){this.a=a},
bM:function bM(a,b,c,d,e,f,g,h){var _=this
_.a=a
_.b=b
_.c=c
_.d=d
_.e=e
_.f=f
_.r=g
_.w=h},
dT:function dT(a){this.a=a},
dU:function dU(a){this.a=a},
dV:function dV(a){this.a=a},
aA:function aA(a,b){this.a=a
this.b=b},
am:function am(a,b,c,d,e){var _=this
_.a=a
_.b=b
_.c=c
_.d=d
_.e=e},
dj:function dj(a,b){this.a=a
this.b=b
this.c=-1},
b8:function b8(a,b,c){this.a=a
this.b=b
this.c=c},
fL(a,b,c,d){var s=new A.bQ(a,b,c)
s.bd(a,b,c)
return s},
bQ:function bQ(a,b,c){this.a=a
this.b=b
this.c=c},
dp(a){var s,r,q,p,o,n,m,l=null
for(s=a.b,r=0,q=!1,p=0;!q;){if(++a.c>=s)throw A.b(A.d0("incomplete VLQ value"))
o=a.gn()
n=$.ia().p(0,o)
if(n==null)throw A.b(A.z("invalid character in VLQ encoding: "+o,l,l))
q=(n&32)===0
r+=B.c.c4(n&31,p)
p+=5}m=r>>>1
r=(r&1)===1?-m:m
if(r<$.iv()||r>$.iu())throw A.b(A.z("expected an encoded 32 bit int, but we got: "+r,l,l))
return r},
eq:function eq(){},
cW:function cW(a,b,c){var _=this
_.a=a
_.b=b
_.c=c
_.d=null},
eP(a,b,c,d){var s=typeof d=="string"?A.R(d):t.I.a(d),r=c==null,q=r?0:c,p=b==null,o=p?a:b
if(a<0)A.a4(A.eN("Offset may not be negative, was "+a+"."))
else if(!r&&c<0)A.a4(A.eN("Line may not be negative, was "+A.i(c)+"."))
else if(!p&&b<0)A.a4(A.eN("Column may not be negative, was "+A.i(b)+"."))
return new A.cX(s,a,q,o)},
cX:function cX(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.d=d},
cY:function cY(){},
cZ:function cZ(){},
iK(a){var s,r,q=u.q
if(a.length===0)return new A.at(A.a8(A.f([],t.J),t.a))
s=$.fl()
if(B.a.u(a,s)){s=B.a.ae(a,s)
r=A.w(s)
return new A.at(A.a8(new A.V(new A.Y(s,r.h("a_(1)").a(new A.dv()),r.h("Y<1>")),r.h("u(1)").a(A.lo()),r.h("V<1,u>")),t.a))}if(!B.a.u(a,q))return new A.at(A.a8(A.f([A.eS(a)],t.J),t.a))
return new A.at(A.a8(new A.y(A.f(a.split(q),t.s),t.cQ.a(A.ln()),t.x),t.a))},
at:function at(a){this.a=a},
dv:function dv(){},
dA:function dA(){},
dz:function dz(){},
dx:function dx(){},
dy:function dy(a){this.a=a},
dw:function dw(a){this.a=a},
iZ(a){return A.fu(A.m(a))},
fu(a){return A.cq(a,new A.dJ(a))},
iY(a){return A.iV(A.m(a))},
iV(a){return A.cq(a,new A.dH(a))},
iS(a){return A.cq(a,new A.dE(a))},
iW(a){return A.iT(A.m(a))},
iT(a){return A.cq(a,new A.dF(a))},
iX(a){return A.iU(A.m(a))},
iU(a){return A.cq(a,new A.dG(a))},
cr(a){if(B.a.u(a,$.hS()))return A.R(a)
else if(B.a.u(a,$.hT()))return A.h8(a,!0)
else if(B.a.q(a,"/"))return A.h8(a,!1)
if(B.a.u(a,"\\"))return $.ix().bG(a)
return A.R(a)},
cq(a,b){var s,r
try{s=b.$0()
return s}catch(r){if(A.cc(r) instanceof A.D)return new A.af(A.E(null,"unparsed",null,null),a)
else throw r}},
l:function l(a,b,c,d){var _=this
_.a=a
_.b=b
_.c=c
_.d=d},
dJ:function dJ(a){this.a=a},
dH:function dH(a){this.a=a},
dI:function dI(a){this.a=a},
dE:function dE(a){this.a=a},
dF:function dF(a){this.a=a},
dG:function dG(a){this.a=a},
cD:function cD(a){this.a=a
this.b=$},
jo(a){if(t.a.b(a))return a
if(a instanceof A.at)return a.bF()
return new A.cD(new A.e1(a))},
eS(a){var s,r,q
try{if(a.length===0){r=A.eR(A.f([],t.F),null)
return r}if(B.a.u(a,$.iq())){r=A.jn(a)
return r}if(B.a.u(a,"\tat ")){r=A.jm(a)
return r}if(B.a.u(a,$.ie())||B.a.u(a,$.ic())){r=A.jl(a)
return r}if(B.a.u(a,u.q)){r=A.iK(a).bF()
return r}if(B.a.u(a,$.ii())){r=A.fQ(a)
return r}r=A.fR(a)
return r}catch(q){r=A.cc(q)
if(r instanceof A.D){s=r
throw A.b(A.z(s.a+"\nStack trace:\n"+a,null,null))}else throw q}},
jq(a){return A.fR(A.m(a))},
fR(a){var s=A.a8(A.jr(a),t.B)
return new A.u(s)},
jr(a){var s,r=B.a.b9(a),q=$.fl(),p=t.U,o=new A.Y(A.f(A.a0(r,q,"").split("\n"),t.s),t.Q.a(new A.e2()),p)
if(!o.gt(0).m())return A.f([],t.F)
r=A.fP(o,o.gl(0)-1,p.h("d.E"))
q=A.t(r)
q=A.fC(r,q.h("l(d.E)").a(A.kW()),q.h("d.E"),t.B)
s=A.cE(q,A.t(q).h("d.E"))
if(!B.a.aQ(o.gH(0),".da"))B.b.k(s,A.fu(o.gH(0)))
return s},
jn(a){var s=t.cN,r=t.B
r=A.a8(A.fC(new A.bO(A.f(a.split("\n"),t.s),t.Q.a(new A.e0()),s),s.h("l(d.E)").a(A.hF()),s.h("d.E"),r),r)
return new A.u(r)},
jm(a){var s=A.a8(new A.V(new A.Y(A.f(a.split("\n"),t.s),t.Q.a(new A.e_()),t.U),t.d.a(A.hF()),t.M),t.B)
return new A.u(s)},
jl(a){var s=A.a8(new A.V(new A.Y(A.f(B.a.b9(a).split("\n"),t.s),t.Q.a(new A.dY()),t.U),t.d.a(A.kU()),t.M),t.B)
return new A.u(s)},
jp(a){return A.fQ(A.m(a))},
fQ(a){var s=a.length===0?A.f([],t.F):new A.V(new A.Y(A.f(B.a.b9(a).split("\n"),t.s),t.Q.a(new A.dZ()),t.U),t.d.a(A.kV()),t.M)
s=A.a8(s,t.B)
return new A.u(s)},
eR(a,b){var s=A.a8(a,t.B)
return new A.u(s)},
u:function u(a){this.a=a},
e1:function e1(a){this.a=a},
e2:function e2(){},
e0:function e0(){},
e_:function e_(){},
dY:function dY(){},
dZ:function dZ(){},
e4:function e4(){},
e3:function e3(a){this.a=a},
af:function af(a,b){this.a=a
this.w=b},
l7(a,b,c){var s=A.jo(b).ga7(),r=A.w(s)
return A.eR(new A.bF(new A.y(s,r.h("l?(1)").a(new A.eC(a,c)),r.h("y<1,l?>")),t.cK),null)},
kE(a){var s,r,q,p,o,n,m,l=B.a.bx(a,".")
if(l<0)return a
s=B.a.B(a,l+1)
a=s==="fn"?a:s
a=A.a0(a,"$124","|")
if(B.a.u(a,"|")){r=B.a.ag(a,"|")
q=B.a.ag(a," ")
p=B.a.ag(a,"escapedPound")
if(q>=0){o=B.a.j(a,0,q)==="set"
a=B.a.j(a,q+1,a.length)}else{n=r+1
if(p>=0){o=B.a.j(a,n,p)==="set"
a=B.a.U(a,n,p+3,"")}else{m=B.a.j(a,n,a.length)
if(B.a.q(m,"unary")||B.a.q(m,"$"))a=A.kL(a)
o=!1}}a=A.a0(a,"|",".")
n=o?a+"=":a}else n=a
return n},
kL(a){return A.lh(a,A.o("\\$[0-9]+",!1),t.A.a(t.bj.a(new A.es(a))),null)},
eC:function eC(a,b){this.a=a
this.b=b},
es:function es(a){this.a=a},
l8(a){var s
A.m(a)
s=$.hw
if(s==null)throw A.b(A.d0("Source maps are not done loading."))
return A.l7(s,A.eS(a),$.iw()).i(0)},
lb(a){$.hw=new A.cC(new A.cF(A.eM(t.N,t.E)),new A.eD(t.g.a(a)))},
l5(){v.G.$dartStackTraceUtility={mapper:A.hs(A.lc()),setSourceMapProvider:A.hs(A.ld())}},
cC:function cC(a,b){this.a=a
this.b=b},
eD:function eD(a){this.a=a},
hP(a){return v.mangledGlobalNames[a]},
eE(a){throw A.G(A.j7(a),new Error())},
j3(a){var s
A:{if(t.h.b(a)){s=a
break A}s=new A.a7(a,A.w(a).h("a7<1,e>"))
break A}return s},
hs(a){var s
if(typeof a=="function")throw A.b(A.L("Attempting to rewrap a JS function."))
s=function(b,c){return function(d){return b(c,d,arguments.length)}}(A.kd,a)
s[$.fh()]=a
return s},
kd(a,b,c){t.Z.a(a)
if(A.bb(c)>=1)return a.$1(b)
return a.$0()},
km(a,b){return a[b]},
hI(a,b,c){A.kP(c,t.H,"T","max")
return Math.max(c.a(a),c.a(b))},
hM(a,b){return Math.pow(a,b)},
f7(){var s,r,q,p,o=null
try{o=A.eV()}catch(s){if(t.W.b(A.cc(s))){r=$.ep
if(r!=null)return r
throw s}else throw s}if(J.as(o,$.hp)){r=$.ep
r.toString
return r}$.hp=o
if($.fi()===$.ar())r=$.ep=o.b7(".").i(0)
else{q=o.b8()
p=q.length-1
r=$.ep=p===0?q:B.a.j(q,0,p)}return r},
fc(a){a|=32
return 97<=a&&a<=122},
hE(a,b){var s,r,q,p=a.length,o=b+2
if(p<o)return b
if(!(b<p))return A.a(a,b)
if(!A.fc(a.charCodeAt(b)))return b
s=b+1
if(!(s<p))return A.a(a,s)
r=a.charCodeAt(s)
if(!(r===58)){s=!1
if(r===37)if(p>=b+4){if(!(o<p))return A.a(a,o)
if(a.charCodeAt(o)===51){s=b+3
if(!(s<p))return A.a(a,s)
s=(a.charCodeAt(s)|32)===97}}if(s)o=b+4
else return b}if(p===o)return o
if(!(o<p))return A.a(a,o)
q=a.charCodeAt(o)
if(q===47)return o+1
if(q===35||q===63)return o
return b},
kT(a,b){var s,r,q,p=a.length
if(b>=p)return b
if(!A.fc(a.charCodeAt(b)))return b
for(s=b+1;s<p;++s){r=a.charCodeAt(s)
q=r|32
if(!(97<=q&&q<=122)&&(r^48)>9&&r!==43&&r!==45&&r!==46){if(r===58)return s+1
break}}return b},
le(a){if(a.length<5)return!1
return a.charCodeAt(4)===58&&(a.charCodeAt(0)|32)===102&&(a.charCodeAt(1)|32)===105&&(a.charCodeAt(2)|32)===108&&(a.charCodeAt(3)|32)===101},
kO(a,b){var s,r
if(!B.a.A(a,"//",b))return b
b+=2
for(s=a.length;b<s;){r=a.charCodeAt(b)
if(r===63||r===35)break
if(r===47)break;++b}return b},
la(a){var s,r,q
for(s=a.length,r=0;r<s;++r){q=a.charCodeAt(r)
if(q===63||q===35)return B.a.j(a,0,r)}return a},
hD(a,b,c){var s,r,q
if(a.length===0)return-1
if(b.$1(B.b.gaR(a)))return 0
if(!b.$1(B.b.gH(a)))return a.length
s=a.length-1
for(r=0;r<s;){q=r+B.c.bm(s-r,2)
if(!(q>=0&&q<a.length))return A.a(a,q)
if(b.$1(a[q]))s=q
else r=q+1}return s}},B={}
var w=[A,J,B]
var $={}
A.eK.prototype={}
J.ct.prototype={
K(a,b){return a===b},
gD(a){return A.cT(a)},
i(a){return"Instance of '"+A.cU(a)+"'"},
gG(a){return A.ap(A.f2(this))}}
J.cv.prototype={
i(a){return String(a)},
gD(a){return a?519018:218159},
gG(a){return A.ap(t.y)},
$ip:1,
$ia_:1}
J.bv.prototype={
K(a,b){return null==b},
i(a){return"null"},
gD(a){return 0},
$ip:1}
J.bx.prototype={$iA:1}
J.av.prototype={
gD(a){return 0},
i(a){return String(a)}}
J.cR.prototype={}
J.b3.prototype={}
J.ad.prototype={
i(a){var s=a[$.hR()]
if(s==null)s=a[$.fh()]
if(s==null)return this.bK(a)
return"JavaScript function for "+J.bj(s)},
$iai:1}
J.bw.prototype={
gD(a){return 0},
i(a){return String(a)}}
J.by.prototype={
gD(a){return 0},
i(a){return String(a)}}
J.v.prototype={
ar(a,b){return new A.a7(a,A.w(a).h("@<1>").L(b).h("a7<1,2>"))},
k(a,b){A.w(a).c.a(b)
a.$flags&1&&A.H(a,29)
a.push(b)},
aE(a,b){var s
a.$flags&1&&A.H(a,"removeAt",1)
s=a.length
if(b>=s)throw A.b(A.dR(b,null))
return a.splice(b,1)[0]},
aY(a,b,c){var s
A.w(a).c.a(c)
a.$flags&1&&A.H(a,"insert",2)
s=a.length
if(b>s)throw A.b(A.dR(b,null))
a.splice(b,0,c)},
aZ(a,b,c){var s,r
A.w(a).h("d<1>").a(c)
a.$flags&1&&A.H(a,"insertAll",2)
A.fJ(b,0,a.length,"index")
if(!t.X.b(c))c=J.iH(c)
s=J.a5(c)
a.length=a.length+s
r=b+s
this.a6(a,r,a.length,a,b)
this.bI(a,b,r,c)},
b6(a){a.$flags&1&&A.H(a,"removeLast",1)
if(a.length===0)throw A.b(A.be(a,-1))
return a.pop()},
ca(a,b){var s
A.w(a).h("d<1>").a(b)
a.$flags&1&&A.H(a,"addAll",2)
if(Array.isArray(b)){this.bP(a,b)
return}for(s=J.ac(b);s.m();)a.push(s.gn())},
bP(a,b){var s,r
t.b.a(b)
s=b.length
if(s===0)return
if(a===b)throw A.b(A.S(a))
for(r=0;r<s;++r)a.push(b[r])},
Z(a,b){var s,r=A.aw(a.length,"",!1,t.N)
for(s=0;s<a.length;++s)this.v(r,s,A.i(a[s]))
return r.join(b)},
aA(a){return this.Z(a,"")},
a4(a,b){return A.al(a,0,A.f5(b,"count",t.S),A.w(a).c)},
V(a,b){return A.al(a,b,null,A.w(a).c)},
F(a,b){if(!(b>=0&&b<a.length))return A.a(a,b)
return a[b]},
gaR(a){if(a.length>0)return a[0]
throw A.b(A.b1())},
gH(a){var s=a.length
if(s>0)return a[s-1]
throw A.b(A.b1())},
a6(a,b,c,d,e){var s,r,q,p,o
A.w(a).h("d<1>").a(d)
a.$flags&2&&A.H(a,5)
A.az(b,c,a.length)
s=c-b
if(s===0)return
A.Q(e,"skipCount")
if(t.j.b(d)){r=d
q=e}else{r=J.ds(d,e).ab(0,!1)
q=0}p=J.aT(r)
if(q+s>p.gl(r))throw A.b(A.fw())
if(q<b)for(o=s-1;o>=0;--o)a[b+o]=p.p(r,q+o)
else for(o=0;o<s;++o)a[b+o]=p.p(r,q+o)},
bI(a,b,c,d){return this.a6(a,b,c,d,0)},
u(a,b){var s
for(s=0;s<a.length;++s)if(J.as(a[s],b))return!0
return!1},
i(a){return A.fx(a,"[","]")},
ab(a,b){var s=A.f(a.slice(0),A.w(a))
return s},
bE(a){return this.ab(a,!0)},
gt(a){return new J.aE(a,a.length,A.w(a).h("aE<1>"))},
gD(a){return A.cT(a)},
gl(a){return a.length},
p(a,b){if(!(b>=0&&b<a.length))throw A.b(A.be(a,b))
return a[b]},
v(a,b,c){A.w(a).c.a(c)
a.$flags&2&&A.H(a)
if(!(b>=0&&b<a.length))throw A.b(A.be(a,b))
a[b]=c},
sH(a,b){var s,r
A.w(a).c.a(b)
s=a.length
if(s===0)throw A.b(A.b1())
r=s-1
a.$flags&2&&A.H(a)
if(!(r>=0))return A.a(a,r)
a[r]=b},
$ih:1,
$id:1,
$ij:1}
J.cu.prototype={
ct(a){var s,r,q
if(!Array.isArray(a))return null
s=a.$flags|0
if((s&4)!==0)r="const, "
else if((s&2)!==0)r="unmodifiable, "
else r=(s&1)!==0?"fixed, ":""
q="Instance of '"+A.cU(a)+"'"
if(r==="")return q
return q+" ("+r+"length: "+a.length+")"}}
J.dK.prototype={}
J.aE.prototype={
gn(){var s=this.d
return s==null?this.$ti.c.a(s):s},
m(){var s,r=this,q=r.a,p=q.length
if(r.b!==p){q=A.fg(q)
throw A.b(q)}s=r.c
if(s>=p){r.d=null
return!1}r.d=q[s]
r.c=s+1
return!0},
$iq:1}
J.cx.prototype={
i(a){if(a===0&&1/a<0)return"-0.0"
else return""+a},
gD(a){var s,r,q,p,o=a|0
if(a===o)return o&536870911
s=Math.abs(a)
r=Math.log(s)/0.6931471805599453|0
q=Math.pow(2,r)
p=s<1?s/q:q/s
return((p*9007199254740992|0)+(p*3542243181176521|0))*599197+r*1259&536870911},
bb(a,b){return a+b},
aG(a,b){var s=a%b
if(s===0)return 0
if(s>0)return s
return s+b},
bm(a,b){return(a|0)===a?a/b|0:this.c8(a,b)},
c8(a,b){var s=a/b
if(s>=-2147483648&&s<=2147483647)return s|0
if(s>0){if(s!==1/0)return Math.floor(s)}else if(s>-1/0)return Math.ceil(s)
throw A.b(A.X("Result of truncating division is "+A.i(s)+": "+A.i(a)+" ~/ "+b))},
c4(a,b){return b>31?0:a<<b>>>0},
ao(a,b){var s
if(a>0)s=this.bl(a,b)
else{s=b>31?31:b
s=a>>s>>>0}return s},
c5(a,b){if(0>b)throw A.b(A.cb(b))
return this.bl(a,b)},
bl(a,b){return b>31?0:a>>>b},
gG(a){return A.ap(t.H)},
$in:1,
$iaq:1}
J.bu.prototype={
gG(a){return A.ap(t.S)},
$ip:1,
$ic:1}
J.cw.prototype={
gG(a){return A.ap(t.i)},
$ip:1}
J.aH.prototype={
cb(a,b){if(b<0)throw A.b(A.be(a,b))
if(b>=a.length)A.a4(A.be(a,b))
return a.charCodeAt(b)},
aq(a,b,c){var s=b.length
if(c>s)throw A.b(A.B(c,0,s,null,null))
return new A.dk(b,a,c)},
ap(a,b){return this.aq(a,b,0)},
bz(a,b,c){var s,r,q,p,o=null
if(c<0||c>b.length)throw A.b(A.B(c,0,b.length,o,o))
s=a.length
r=b.length
if(c+s>r)return o
for(q=0;q<s;++q){p=c+q
if(!(p>=0&&p<r))return A.a(b,p)
if(b.charCodeAt(p)!==a.charCodeAt(q))return o}return new A.bS(c,a)},
aQ(a,b){var s=b.length,r=a.length
if(s>r)return!1
return b===this.B(a,r-s)},
bD(a,b,c){A.fJ(0,0,a.length,"startIndex")
return A.ll(a,b,c,0)},
ae(a,b){var s
if(typeof b=="string")return A.f(a.split(b),t.s)
else{if(b instanceof A.au){s=b.e
s=!(s==null?b.e=b.bQ():s)}else s=!1
if(s)return A.f(a.split(b.b),t.s)
else return this.bT(a,b)}},
U(a,b,c,d){var s=A.az(b,c,a.length)
return A.ff(a,b,s,d)},
bT(a,b){var s,r,q,p,o,n,m=A.f([],t.s)
for(s=J.eG(b,a),s=s.gt(s),r=0,q=1;s.m();){p=s.gn()
o=p.gJ()
n=p.gM()
q=n-o
if(q===0&&r===o)continue
B.b.k(m,this.j(a,r,o))
r=n}if(r<a.length||q>0)B.b.k(m,this.B(a,r))
return m},
A(a,b,c){var s
if(c<0||c>a.length)throw A.b(A.B(c,0,a.length,null,null))
if(typeof b=="string"){s=c+b.length
if(s>a.length)return!1
return b===a.substring(c,s)}return J.iF(b,a,c)!=null},
q(a,b){return this.A(a,b,0)},
j(a,b,c){return a.substring(b,A.az(b,c,a.length))},
B(a,b){return this.j(a,b,null)},
b9(a){var s,r,q,p=a.trim(),o=p.length
if(o===0)return p
if(0>=o)return A.a(p,0)
if(p.charCodeAt(0)===133){s=J.j5(p,1)
if(s===o)return""}else s=0
r=o-1
if(!(r>=0))return A.a(p,r)
q=p.charCodeAt(r)===133?J.j6(p,r):o
if(s===0&&q===o)return p
return p.substring(s,q)},
bc(a,b){var s,r
if(0>=b)return""
if(b===1||a.length===0)return a
if(b!==b>>>0)throw A.b(B.G)
for(s=a,r="";;){if((b&1)===1)r=s+r
b=b>>>1
if(b===0)break
s+=s}return r},
bA(a,b){var s=b-a.length
if(s<=0)return a
return a+this.bc(" ",s)},
a2(a,b,c){var s
if(c<0||c>a.length)throw A.b(A.B(c,0,a.length,null,null))
s=a.indexOf(b,c)
return s},
ag(a,b){return this.a2(a,b,0)},
by(a,b,c){var s,r
if(c==null)c=a.length
else if(c<0||c>a.length)throw A.b(A.B(c,0,a.length,null,null))
s=b.length
r=a.length
if(c+s>r)c=r-s
return a.lastIndexOf(b,c)},
bx(a,b){return this.by(a,b,null)},
u(a,b){return A.lg(a,b,0)},
i(a){return a},
gD(a){var s,r,q
for(s=a.length,r=0,q=0;q<s;++q){r=r+a.charCodeAt(q)&536870911
r=r+((r&524287)<<10)&536870911
r^=r>>6}r=r+((r&67108863)<<3)&536870911
r^=r>>11
return r+((r&16383)<<15)&536870911},
gG(a){return A.ap(t.N)},
gl(a){return a.length},
$ip:1,
$idQ:1,
$ie:1}
A.aB.prototype={
gt(a){return new A.bk(J.ac(this.gX()),A.t(this).h("bk<1,2>"))},
gl(a){return J.a5(this.gX())},
V(a,b){var s=A.t(this)
return A.dt(J.ds(this.gX(),b),s.c,s.y[1])},
a4(a,b){var s=A.t(this)
return A.dt(J.fm(this.gX(),b),s.c,s.y[1])},
F(a,b){return A.t(this).y[1].a(J.dr(this.gX(),b))},
u(a,b){return J.iD(this.gX(),b)},
i(a){return J.bj(this.gX())}}
A.bk.prototype={
m(){return this.a.m()},
gn(){return this.$ti.y[1].a(this.a.gn())},
$iq:1}
A.aF.prototype={
gX(){return this.a}}
A.c_.prototype={$ih:1}
A.bZ.prototype={
p(a,b){return this.$ti.y[1].a(J.iy(this.a,b))},
v(a,b,c){var s=this.$ti
J.iz(this.a,b,s.c.a(s.y[1].a(c)))},
$ih:1,
$ij:1}
A.a7.prototype={
ar(a,b){return new A.a7(this.a,this.$ti.h("@<1>").L(b).h("a7<1,2>"))},
gX(){return this.a}}
A.aG.prototype={
br(a,b,c){return new A.aG(this.a,this.$ti.h("@<1,2>").L(b).L(c).h("aG<1,2,3,4>"))},
O(a){return this.a.O(a)},
p(a,b){return this.$ti.h("4?").a(this.a.p(0,b))},
a0(a,b){this.a.a0(0,new A.du(this,this.$ti.h("~(3,4)").a(b)))},
ga_(){var s=this.$ti
return A.dt(this.a.ga_(),s.c,s.y[2])},
gl(a){var s=this.a
return s.gl(s)}}
A.du.prototype={
$2(a,b){var s=this.a.$ti
s.c.a(a)
s.y[1].a(b)
this.b.$2(s.y[2].a(a),s.y[3].a(b))},
$S(){return this.a.$ti.h("~(1,2)")}}
A.cB.prototype={
i(a){return"LateInitializationError: "+this.a}}
A.bl.prototype={
gl(a){return this.a.length},
p(a,b){var s=this.a
if(!(b>=0&&b<s.length))return A.a(s,b)
return s.charCodeAt(b)}}
A.dS.prototype={}
A.h.prototype={}
A.I.prototype={
gt(a){var s=this
return new A.U(s,s.gl(s),A.t(s).h("U<I.E>"))},
u(a,b){var s,r=this,q=r.gl(r)
for(s=0;s<q;++s){if(J.as(r.F(0,s),b))return!0
if(q!==r.gl(r))throw A.b(A.S(r))}return!1},
Z(a,b){var s,r,q,p=this,o=p.gl(p)
if(b.length!==0){if(o===0)return""
s=A.i(p.F(0,0))
if(o!==p.gl(p))throw A.b(A.S(p))
for(r=s,q=1;q<o;++q){r=r+b+A.i(p.F(0,q))
if(o!==p.gl(p))throw A.b(A.S(p))}return r.charCodeAt(0)==0?r:r}else{for(q=0,r="";q<o;++q){r+=A.i(p.F(0,q))
if(o!==p.gl(p))throw A.b(A.S(p))}return r.charCodeAt(0)==0?r:r}},
aA(a){return this.Z(0,"")},
aS(a,b,c,d){var s,r,q,p=this
d.a(b)
A.t(p).L(d).h("1(1,I.E)").a(c)
s=p.gl(p)
for(r=b,q=0;q<s;++q){r=c.$2(r,p.F(0,q))
if(s!==p.gl(p))throw A.b(A.S(p))}return r},
V(a,b){return A.al(this,b,null,A.t(this).h("I.E"))},
a4(a,b){return A.al(this,0,A.f5(b,"count",t.S),A.t(this).h("I.E"))}}
A.bT.prototype={
gbU(){var s=J.a5(this.a),r=this.c
if(r==null||r>s)return s
return r},
gc7(){var s=J.a5(this.a),r=this.b
if(r>s)return s
return r},
gl(a){var s,r=J.a5(this.a),q=this.b
if(q>=r)return 0
s=this.c
if(s==null||s>=r)return r-q
return s-q},
F(a,b){var s=this,r=s.gc7()+b
if(b<0||r>=s.gbU())throw A.b(A.eI(b,s.gl(0),s,"index"))
return J.dr(s.a,r)},
V(a,b){var s,r,q=this
A.Q(b,"count")
s=q.b+b
r=q.c
if(r!=null&&s>=r)return new A.bo(q.$ti.h("bo<1>"))
return A.al(q.a,s,r,q.$ti.c)},
a4(a,b){var s,r,q,p=this
A.Q(b,"count")
s=p.c
r=p.b
if(s==null)return A.al(p.a,r,B.c.bb(r,b),p.$ti.c)
else{q=B.c.bb(r,b)
if(s<q)return p
return A.al(p.a,r,q,p.$ti.c)}},
ab(a,b){var s,r,q,p=this,o=p.b,n=p.a,m=J.aT(n),l=m.gl(n),k=p.c
if(k!=null&&k<l)l=k
s=l-o
if(s<=0){n=p.$ti.c
return b?J.fz(0,n):J.fy(0,n)}r=A.aw(s,m.F(n,o),b,p.$ti.c)
for(q=1;q<s;++q){B.b.v(r,q,m.F(n,o+q))
if(m.gl(n)<l)throw A.b(A.S(p))}return r}}
A.U.prototype={
gn(){var s=this.d
return s==null?this.$ti.c.a(s):s},
m(){var s,r=this,q=r.a,p=J.aT(q),o=p.gl(q)
if(r.b!==o)throw A.b(A.S(q))
s=r.c
if(s>=o){r.d=null
return!1}r.d=p.F(q,s);++r.c
return!0},
$iq:1}
A.V.prototype={
gt(a){return new A.bB(J.ac(this.a),this.b,A.t(this).h("bB<1,2>"))},
gl(a){return J.a5(this.a)},
F(a,b){return this.b.$1(J.dr(this.a,b))}}
A.bm.prototype={$ih:1}
A.bB.prototype={
m(){var s=this,r=s.b
if(r.m()){s.a=s.c.$1(r.gn())
return!0}s.a=null
return!1},
gn(){var s=this.a
return s==null?this.$ti.y[1].a(s):s},
$iq:1}
A.y.prototype={
gl(a){return J.a5(this.a)},
F(a,b){return this.b.$1(J.dr(this.a,b))}}
A.Y.prototype={
gt(a){return new A.aP(J.ac(this.a),this.b,this.$ti.h("aP<1>"))}}
A.aP.prototype={
m(){var s,r
for(s=this.a,r=this.b;s.m();)if(r.$1(s.gn()))return!0
return!1},
gn(){return this.a.gn()},
$iq:1}
A.br.prototype={
gt(a){return new A.bs(J.ac(this.a),this.b,B.p,this.$ti.h("bs<1,2>"))}}
A.bs.prototype={
gn(){var s=this.d
return s==null?this.$ti.y[1].a(s):s},
m(){var s,r,q=this,p=q.c
if(p==null)return!1
for(s=q.a,r=q.b;!p.m();){q.d=null
if(s.m()){q.c=null
p=J.ac(r.$1(s.gn()))
q.c=p}else return!1}q.d=q.c.gn()
return!0},
$iq:1}
A.aN.prototype={
gt(a){var s=this.a
return new A.bU(s.gt(s),this.b,A.t(this).h("bU<1>"))}}
A.bn.prototype={
gl(a){var s=this.a,r=s.gl(s)
s=this.b
if(r>s)return s
return r},
$ih:1}
A.bU.prototype={
m(){if(--this.b>=0)return this.a.m()
this.b=-1
return!1},
gn(){if(this.b<0){this.$ti.c.a(null)
return null}return this.a.gn()},
$iq:1}
A.ak.prototype={
V(a,b){A.aX(b,"count",t.S)
A.Q(b,"count")
return new A.ak(this.a,this.b+b,A.t(this).h("ak<1>"))},
gt(a){var s=this.a
return new A.bN(s.gt(s),this.b,A.t(this).h("bN<1>"))}}
A.aZ.prototype={
gl(a){var s=this.a,r=s.gl(s)-this.b
if(r>=0)return r
return 0},
V(a,b){A.aX(b,"count",t.S)
A.Q(b,"count")
return new A.aZ(this.a,this.b+b,this.$ti)},
$ih:1}
A.bN.prototype={
m(){var s,r
for(s=this.a,r=0;r<this.b;++r)s.m()
this.b=0
return s.m()},
gn(){return this.a.gn()},
$iq:1}
A.bO.prototype={
gt(a){return new A.bP(J.ac(this.a),this.b,this.$ti.h("bP<1>"))}}
A.bP.prototype={
m(){var s,r,q=this
if(!q.c){q.c=!0
for(s=q.a,r=q.b;s.m();)if(!r.$1(s.gn()))return!0}return q.a.m()},
gn(){return this.a.gn()},
$iq:1}
A.bo.prototype={
gt(a){return B.p},
gl(a){return 0},
F(a,b){throw A.b(A.B(b,0,0,"index",null))},
u(a,b){return!1},
V(a,b){A.Q(b,"count")
return this},
a4(a,b){A.Q(b,"count")
return this}}
A.bp.prototype={
m(){return!1},
gn(){throw A.b(A.b1())},
$iq:1}
A.bF.prototype={
gt(a){var s=this.a
return new A.bG(new A.U(s,s.gl(0),s.$ti.h("U<I.E>")),this.$ti.h("bG<1>"))}}
A.bG.prototype={
m(){var s,r,q
this.b=null
for(s=this.a,r=s.$ti.c;s.m();){q=s.d
if(q==null)q=r.a(q)
if(q!=null){this.b=q
return!0}}return!1},
gn(){var s=this.b
return s==null?A.a4(A.b1()):s},
$iq:1}
A.N.prototype={}
A.aO.prototype={
v(a,b,c){A.t(this).h("aO.E").a(c)
throw A.b(A.X("Cannot modify an unmodifiable list"))}}
A.b4.prototype={}
A.ca.prototype={}
A.cs.prototype={
K(a,b){if(b==null)return!1
return b instanceof A.b_&&this.a.K(0,b.a)&&A.fa(this)===A.fa(b)},
gD(a){return A.fD(this.a,A.fa(this),B.j)},
i(a){var s=B.b.Z([A.ap(this.$ti.c)],", ")
return this.a.i(0)+" with "+("<"+s+">")}}
A.b_.prototype={
$2(a,b){return this.a.$1$2(a,b,this.$ti.y[0])},
$S(){return A.l2(A.et(this.a),this.$ti)}}
A.bL.prototype={}
A.e5.prototype={
T(a){var s,r,q=this,p=new RegExp(q.a).exec(a)
if(p==null)return null
s=Object.create(null)
r=q.b
if(r!==-1)s.arguments=p[r+1]
r=q.c
if(r!==-1)s.argumentsExpr=p[r+1]
r=q.d
if(r!==-1)s.expr=p[r+1]
r=q.e
if(r!==-1)s.method=p[r+1]
r=q.f
if(r!==-1)s.receiver=p[r+1]
return s}}
A.bI.prototype={
i(a){return"Null check operator used on a null value"}}
A.cy.prototype={
i(a){var s,r=this,q="NoSuchMethodError: method not found: '",p=r.b
if(p==null)return"NoSuchMethodError: "+r.a
s=r.c
if(s==null)return q+p+"' ("+r.a+")"
return q+p+"' on '"+s+"' ("+r.a+")"}}
A.d5.prototype={
i(a){var s=this.a
return s.length===0?"Error":"Error: "+s}}
A.cP.prototype={
i(a){return"Throw of null ('"+(this.a===null?"null":"undefined")+"' from JavaScript)"},
$ibq:1}
A.M.prototype={
i(a){var s=this.constructor,r=s==null?null:s.name
return"Closure '"+A.hQ(r==null?"unknown":r)+"'"},
$iai:1,
gcu(){return this},
$C:"$1",
$R:1,
$D:null}
A.cl.prototype={$C:"$0",$R:0}
A.cm.prototype={$C:"$2",$R:2}
A.d3.prototype={}
A.d1.prototype={
i(a){var s=this.$static_name
if(s==null)return"Closure of unknown static method"
return"Closure '"+A.hQ(s)+"'"}}
A.aY.prototype={
K(a,b){if(b==null)return!1
if(this===b)return!0
if(!(b instanceof A.aY))return!1
return this.$_target===b.$_target&&this.a===b.a},
gD(a){return(A.hJ(this.a)^A.cT(this.$_target))>>>0},
i(a){return"Closure '"+this.$_name+"' of "+("Instance of '"+A.cU(this.a)+"'")}}
A.cV.prototype={
i(a){return"RuntimeError: "+this.a}}
A.bz.prototype={
gl(a){return this.a},
ga_(){return new A.aI(this,A.t(this).h("aI<1>"))},
O(a){var s=this.b
if(s==null)return!1
return s[a]!=null},
p(a,b){var s,r,q,p,o=null
if(typeof b=="string"){s=this.b
if(s==null)return o
r=s[b]
q=r==null?o:r.b
return q}else if(typeof b=="number"&&(b&0x3fffffff)===b){p=this.c
if(p==null)return o
r=p[b]
q=r==null?o:r.b
return q}else return this.ck(b)},
ck(a){var s,r,q=this.d
if(q==null)return null
s=this.bY(q,a)
r=this.bv(s,a)
if(r<0)return null
return s[r].b},
v(a,b,c){var s,r,q,p,o,n,m=this,l=A.t(m)
l.c.a(b)
l.y[1].a(c)
if(typeof b=="string"){s=m.b
m.be(s==null?m.b=m.aK():s,b,c)}else if(typeof b=="number"&&(b&0x3fffffff)===b){r=m.c
m.be(r==null?m.c=m.aK():r,b,c)}else{q=m.d
if(q==null)q=m.d=m.aK()
p=m.bu(b)
o=q[p]
if(o==null)q[p]=[m.aL(b,c)]
else{n=m.bv(o,b)
if(n>=0)o[n].b=c
else o.push(m.aL(b,c))}}},
a0(a,b){var s,r,q=this
A.t(q).h("~(1,2)").a(b)
s=q.e
r=q.r
while(s!=null){b.$2(s.a,s.b)
if(r!==q.r)throw A.b(A.S(q))
s=s.c}},
be(a,b,c){var s,r=A.t(this)
r.c.a(b)
r.y[1].a(c)
s=a[b]
if(s==null)a[b]=this.aL(b,c)
else s.b=c},
aL(a,b){var s=this,r=A.t(s),q=new A.dL(r.c.a(a),r.y[1].a(b))
if(s.e==null)s.e=s.f=q
else s.f=s.f.c=q;++s.a
s.r=s.r+1&1073741823
return q},
bu(a){return J.aW(a)&1073741823},
bY(a,b){return a[this.bu(b)]},
bv(a,b){var s,r
if(a==null)return-1
s=a.length
for(r=0;r<s;++r)if(J.as(a[r].a,b))return r
return-1},
i(a){return A.fB(this)},
aK(){var s=Object.create(null)
s["<non-identifier-key>"]=s
delete s["<non-identifier-key>"]
return s}}
A.dL.prototype={}
A.aI.prototype={
gl(a){return this.a.a},
gt(a){var s=this.a
return new A.bA(s,s.r,s.e,this.$ti.h("bA<1>"))},
u(a,b){return this.a.O(b)}}
A.bA.prototype={
gn(){return this.d},
m(){var s,r=this,q=r.a
if(r.b!==q.r)throw A.b(A.S(q))
s=r.c
if(s==null){r.d=null
return!1}else{r.d=s.a
r.c=s.c
return!0}},
$iq:1}
A.dM.prototype={
gl(a){return this.a.a},
gt(a){var s=this.a
return new A.aJ(s,s.r,s.e,this.$ti.h("aJ<1>"))}}
A.aJ.prototype={
gn(){return this.d},
m(){var s,r=this,q=r.a
if(r.b!==q.r)throw A.b(A.S(q))
s=r.c
if(s==null){r.d=null
return!1}else{r.d=s.b
r.c=s.c
return!0}},
$iq:1}
A.ex.prototype={
$1(a){return this.a(a)},
$S:9}
A.ey.prototype={
$2(a,b){return this.a(a,b)},
$S:10}
A.ez.prototype={
$1(a){return this.a(A.m(a))},
$S:11}
A.au.prototype={
i(a){return"RegExp/"+this.a+"/"+this.b.flags},
gbk(){var s=this,r=s.c
if(r!=null)return r
r=s.b
return s.c=A.eJ(s.a,r.multiline,!r.ignoreCase,r.unicode,r.dotAll,"g")},
gc0(){var s=this,r=s.d
if(r!=null)return r
r=s.b
return s.d=A.eJ(s.a,r.multiline,!r.ignoreCase,r.unicode,r.dotAll,"y")},
bQ(){var s,r=this.a
if(!B.a.u(r,"("))return!1
s=this.b.unicode?"u":""
return new RegExp("(?:)|"+r,s).exec("").length>1},
S(a){var s=this.b.exec(a)
if(s==null)return null
return new A.b5(s)},
aq(a,b,c){var s=b.length
if(c>s)throw A.b(A.B(c,0,s,null,null))
return new A.dd(this,b,c)},
ap(a,b){return this.aq(0,b,0)},
bg(a,b){var s,r=this.gbk()
if(r==null)r=A.en(r)
r.lastIndex=b
s=r.exec(a)
if(s==null)return null
return new A.b5(s)},
bV(a,b){var s,r=this.gc0()
if(r==null)r=A.en(r)
r.lastIndex=b
s=r.exec(a)
if(s==null)return null
return new A.b5(s)},
bz(a,b,c){if(c<0||c>b.length)throw A.b(A.B(c,0,b.length,null,null))
return this.bV(b,c)},
$idQ:1,
$ije:1}
A.b5.prototype={
gJ(){return this.b.index},
gM(){var s=this.b
return s.index+s[0].length},
p(a,b){var s=this.b
if(!(b<s.length))return A.a(s,b)
return s[b]},
W(a){var s,r=this.b.groups
if(r!=null){s=r[a]
if(s!=null||a in r)return s}throw A.b(A.ce(a,"name","Not a capture group name"))},
$iae:1,
$ibK:1}
A.dd.prototype={
gt(a){return new A.bY(this.a,this.b,this.c)}}
A.bY.prototype={
gn(){var s=this.d
return s==null?t.k.a(s):s},
m(){var s,r,q,p,o,n,m=this,l=m.b
if(l==null)return!1
s=m.c
r=l.length
if(s<=r){q=m.a
p=q.bg(l,s)
if(p!=null){m.d=p
o=p.gM()
if(p.b.index===o){s=!1
if(q.b.unicode){q=m.c
n=q+1
if(n<r){if(!(q>=0&&q<r))return A.a(l,q)
q=l.charCodeAt(q)
if(q>=55296&&q<=56319){if(!(n>=0))return A.a(l,n)
s=l.charCodeAt(n)
s=s>=56320&&s<=57343}}}o=(s?o+1:o)+1}m.c=o
return!0}}m.b=m.d=null
return!1},
$iq:1}
A.bS.prototype={
gM(){return this.a+this.c.length},
p(a,b){if(b!==0)throw A.b(A.dR(b,null))
return this.c},
$iae:1,
gJ(){return this.a}}
A.dk.prototype={
gt(a){return new A.dl(this.a,this.b,this.c)}}
A.dl.prototype={
m(){var s,r,q=this,p=q.c,o=q.b,n=o.length,m=q.a,l=m.length
if(p+n>l){q.d=null
return!1}s=m.indexOf(o,p)
if(s<0){q.c=l+1
q.d=null
return!1}r=s+n
q.d=new A.bS(s,o)
q.c=r===q.c?r+1:r
return!0},
gn(){var s=this.d
s.toString
return s},
$iq:1}
A.b2.prototype={
gG(a){return B.U},
$ip:1}
A.bD.prototype={
bZ(a,b,c,d){var s=A.B(b,0,c,d,null)
throw A.b(s)},
bf(a,b,c,d){if(b>>>0!==b||b>c)this.bZ(a,b,c,d)}}
A.cH.prototype={
gG(a){return B.V},
$ip:1}
A.J.prototype={
gl(a){return a.length},
c3(a,b,c,d,e){var s,r,q=a.length
this.bf(a,b,q,"start")
this.bf(a,c,q,"end")
if(b>c)throw A.b(A.B(b,0,c,null,null))
s=c-b
if(e<0)throw A.b(A.L(e))
r=d.length
if(r-e<s)throw A.b(A.d0("Not enough elements"))
if(e!==0||r!==s)d=d.subarray(e,e+s)
a.set(d,b)},
$iT:1}
A.bC.prototype={
p(a,b){A.ao(b,a,a.length)
return a[b]},
v(a,b,c){A.hn(c)
a.$flags&2&&A.H(a)
A.ao(b,a,a.length)
a[b]=c},
$ih:1,
$id:1,
$ij:1}
A.W.prototype={
v(a,b,c){A.bb(c)
a.$flags&2&&A.H(a)
A.ao(b,a,a.length)
a[b]=c},
a6(a,b,c,d,e){t.Y.a(d)
a.$flags&2&&A.H(a,5)
if(t.cu.b(d)){this.c3(a,b,c,d,e)
return}this.bL(a,b,c,d,e)},
$ih:1,
$id:1,
$ij:1}
A.cI.prototype={
gG(a){return B.W},
$ip:1}
A.cJ.prototype={
gG(a){return B.X},
$ip:1}
A.cK.prototype={
gG(a){return B.Y},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1}
A.cL.prototype={
gG(a){return B.Z},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1}
A.cM.prototype={
gG(a){return B.a_},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1}
A.cN.prototype={
gG(a){return B.a1},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1}
A.cO.prototype={
gG(a){return B.a2},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1,
$ieT:1}
A.bE.prototype={
gG(a){return B.a3},
gl(a){return a.length},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1}
A.aK.prototype={
gG(a){return B.a4},
gl(a){return a.length},
p(a,b){A.ao(b,a,a.length)
return a[b]},
$ip:1,
$iaK:1,
$ieU:1}
A.c0.prototype={}
A.c1.prototype={}
A.c2.prototype={}
A.c3.prototype={}
A.a9.prototype={
h(a){return A.ed(v.typeUniverse,this,a)},
L(a){return A.jQ(v.typeUniverse,this,a)}}
A.dg.prototype={}
A.eb.prototype={
i(a){return A.O(this.a,null)}}
A.df.prototype={
i(a){return this.a}}
A.b9.prototype={}
A.k.prototype={
gt(a){return new A.U(a,this.gl(a),A.aa(a).h("U<k.E>"))},
F(a,b){return this.p(a,b)},
u(a,b){var s,r=this.gl(a)
for(s=0;s<r;++s){if(J.as(this.p(a,s),b))return!0
if(r!==this.gl(a))throw A.b(A.S(a))}return!1},
V(a,b){return A.al(a,b,null,A.aa(a).h("k.E"))},
a4(a,b){return A.al(a,0,A.f5(b,"count",t.S),A.aa(a).h("k.E"))},
ar(a,b){return new A.a7(a,A.aa(a).h("@<k.E>").L(b).h("a7<1,2>"))},
ci(a,b,c,d){var s,r,q=A.aa(a)
q.h("k.E?").a(d)
s=d==null?q.h("k.E").a(d):d
A.az(b,c,this.gl(a))
for(r=b;r<c;++r)this.v(a,r,s)},
a6(a,b,c,d,e){var s,r,q,p,o
A.aa(a).h("d<k.E>").a(d)
A.az(b,c,this.gl(a))
s=c-b
if(s===0)return
A.Q(e,"skipCount")
if(t.j.b(d)){r=e
q=d}else{q=J.ds(d,e).ab(0,!1)
r=0}p=J.aT(q)
if(r+s>p.gl(q))throw A.b(A.fw())
if(r<b)for(o=s-1;o>=0;--o)this.v(a,b+o,p.p(q,r+o))
else for(o=0;o<s;++o)this.v(a,b+o,p.p(q,r+o))},
i(a){return A.fx(a,"[","]")},
$ih:1,
$id:1,
$ij:1}
A.F.prototype={
br(a,b,c){var s=A.t(this)
return A.j8(this,s.h("F.K"),s.h("F.V"),b,c)},
a0(a,b){var s,r,q,p=A.t(this)
p.h("~(F.K,F.V)").a(b)
for(s=this.ga_(),s=s.gt(s),p=p.h("F.V");s.m();){r=s.gn()
q=this.p(0,r)
b.$2(r,q==null?p.a(q):q)}},
O(a){return this.ga_().u(0,a)},
gl(a){var s=this.ga_()
return s.gl(s)},
i(a){return A.fB(this)},
$iax:1}
A.dO.prototype={
$2(a,b){var s,r=this.a
if(!r.a)this.b.a+=", "
r.a=!1
r=this.b
s=A.i(a)
r.a=(r.a+=s)+": "
s=A.i(b)
r.a+=s},
$S:12}
A.dh.prototype={
p(a,b){var s,r=this.b
if(r==null)return this.c.p(0,b)
else if(typeof b!="string")return null
else{s=r[b]
return typeof s=="undefined"?this.c2(b):s}},
gl(a){return this.b==null?this.c.a:this.am().length},
ga_(){if(this.b==null){var s=this.c
return new A.aI(s,A.t(s).h("aI<1>"))}return new A.di(this)},
O(a){if(this.b==null)return this.c.O(a)
return Object.prototype.hasOwnProperty.call(this.a,a)},
a0(a,b){var s,r,q,p,o=this
t.bm.a(b)
if(o.b==null)return o.c.a0(0,b)
s=o.am()
for(r=0;r<s.length;++r){q=s[r]
p=o.b[q]
if(typeof p=="undefined"){p=A.eo(o.a[q])
o.b[q]=p}b.$2(q,p)
if(s!==o.c)throw A.b(A.S(o))}},
am(){var s=t.O.a(this.c)
if(s==null)s=this.c=A.f(Object.keys(this.a),t.s)
return s},
c2(a){var s
if(!Object.prototype.hasOwnProperty.call(this.a,a))return null
s=A.eo(this.a[a])
return this.b[a]=s}}
A.di.prototype={
gl(a){return this.a.gl(0)},
F(a,b){var s=this.a
if(s.b==null)s=s.ga_().F(0,b)
else{s=s.am()
if(!(b>=0&&b<s.length))return A.a(s,b)
s=s[b]}return s},
gt(a){var s=this.a
if(s.b==null){s=s.ga_()
s=s.gt(s)}else{s=s.am()
s=new J.aE(s,s.length,A.w(s).h("aE<1>"))}return s},
u(a,b){return this.a.O(b)}}
A.ek.prototype={
$0(){var s,r
try{s=new TextDecoder("utf-8",{fatal:true})
return s}catch(r){}return null},
$S:4}
A.ej.prototype={
$0(){var s,r
try{s=new TextDecoder("utf-8",{fatal:false})
return s}catch(r){}return null},
$S:4}
A.cf.prototype={
cg(a){return B.w.af(a)}}
A.dm.prototype={
af(a){var s,r,q,p,o,n
A.m(a)
s=a.length
r=A.az(0,null,s)
q=new Uint8Array(r)
for(p=~this.a,o=0;o<r;++o){if(!(o<s))return A.a(a,o)
n=a.charCodeAt(o)
if((n&p)!==0)throw A.b(A.ce(a,"string","Contains invalid characters."))
if(!(o<r))return A.a(q,o)
q[o]=n}return q}}
A.cg.prototype={}
A.cj.prototype={
cn(a3,a4,a5){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c,b,a,a0=u.n,a1="Invalid base64 encoding length ",a2=a3.length
a5=A.az(a4,a5,a2)
s=$.i4()
for(r=s.length,q=a4,p=q,o=null,n=-1,m=-1,l=0;q<a5;q=k){k=q+1
if(!(q<a2))return A.a(a3,q)
j=a3.charCodeAt(q)
if(j===37){i=k+2
if(i<=a5){if(!(k<a2))return A.a(a3,k)
h=A.ew(a3.charCodeAt(k))
g=k+1
if(!(g<a2))return A.a(a3,g)
f=A.ew(a3.charCodeAt(g))
e=h*16+f-(f&256)
if(e===37)e=-1
k=i}else e=-1}else e=j
if(0<=e&&e<=127){if(!(e>=0&&e<r))return A.a(s,e)
d=s[e]
if(d>=0){if(!(d<64))return A.a(a0,d)
e=a0.charCodeAt(d)
if(e===j)continue
j=e}else{if(d===-1){if(n<0){g=o==null?null:o.a.length
if(g==null)g=0
n=g+(q-p)
m=q}++l
if(j===61)continue}j=e}if(d!==-2){if(o==null){o=new A.K("")
g=o}else g=o
g.a+=B.a.j(a3,p,q)
c=A.P(j)
g.a+=c
p=k
continue}}throw A.b(A.z("Invalid base64 data",a3,q))}if(o!=null){a2=B.a.j(a3,p,a5)
a2=o.a+=a2
r=a2.length
if(n>=0)A.fo(a3,m,a5,n,l,r)
else{b=B.c.aG(r-1,4)+1
if(b===1)throw A.b(A.z(a1,a3,a5))
while(b<4){a2+="="
o.a=a2;++b}}a2=o.a
return B.a.U(a3,a4,a5,a2.charCodeAt(0)==0?a2:a2)}a=a5-a4
if(n>=0)A.fo(a3,m,a5,n,l,a)
else{b=B.c.aG(a,4)
if(b===1)throw A.b(A.z(a1,a3,a5))
if(b>1)a3=B.a.U(a3,a5,a5,b===2?"==":"=")}return a3}}
A.ck.prototype={}
A.ag.prototype={}
A.e9.prototype={}
A.ah.prototype={}
A.cp.prototype={}
A.cz.prototype={
cc(a,b){var s=A.kD(a,this.gce().a)
return s},
gce(){return B.S}}
A.cA.prototype={}
A.d9.prototype={}
A.db.prototype={
af(a){var s,r,q,p,o,n
A.m(a)
s=a.length
r=A.az(0,null,s)
if(r===0)return new Uint8Array(0)
q=r*3
p=new Uint8Array(q)
o=new A.el(p)
if(o.bW(a,0,r)!==r){n=r-1
if(!(n>=0&&n<s))return A.a(a,n)
o.aN()}return new Uint8Array(p.subarray(0,A.kf(0,o.b,q)))}}
A.el.prototype={
aN(){var s,r=this,q=r.c,p=r.b,o=r.b=p+1
q.$flags&2&&A.H(q)
s=q.length
if(!(p<s))return A.a(q,p)
q[p]=239
p=r.b=o+1
if(!(o<s))return A.a(q,o)
q[o]=191
r.b=p+1
if(!(p<s))return A.a(q,p)
q[p]=189},
c9(a,b){var s,r,q,p,o,n=this
if((b&64512)===56320){s=65536+((a&1023)<<10)|b&1023
r=n.c
q=n.b
p=n.b=q+1
r.$flags&2&&A.H(r)
o=r.length
if(!(q<o))return A.a(r,q)
r[q]=s>>>18|240
q=n.b=p+1
if(!(p<o))return A.a(r,p)
r[p]=s>>>12&63|128
p=n.b=q+1
if(!(q<o))return A.a(r,q)
r[q]=s>>>6&63|128
n.b=p+1
if(!(p<o))return A.a(r,p)
r[p]=s&63|128
return!0}else{n.aN()
return!1}},
bW(a,b,c){var s,r,q,p,o,n,m,l,k=this
if(b!==c){s=c-1
if(!(s>=0&&s<a.length))return A.a(a,s)
s=(a.charCodeAt(s)&64512)===55296}else s=!1
if(s)--c
for(s=k.c,r=s.$flags|0,q=s.length,p=a.length,o=b;o<c;++o){if(!(o<p))return A.a(a,o)
n=a.charCodeAt(o)
if(n<=127){m=k.b
if(m>=q)break
k.b=m+1
r&2&&A.H(s)
s[m]=n}else{m=n&64512
if(m===55296){if(k.b+4>q)break
m=o+1
if(!(m<p))return A.a(a,m)
if(k.c9(n,a.charCodeAt(m)))o=m}else if(m===56320){if(k.b+3>q)break
k.aN()}else if(n<=2047){m=k.b
l=m+1
if(l>=q)break
k.b=l
r&2&&A.H(s)
if(!(m<q))return A.a(s,m)
s[m]=n>>>6|192
k.b=l+1
s[l]=n&63|128}else{m=k.b
if(m+2>=q)break
l=k.b=m+1
r&2&&A.H(s)
if(!(m<q))return A.a(s,m)
s[m]=n>>>12|224
m=k.b=l+1
if(!(l<q))return A.a(s,l)
s[l]=n>>>6&63|128
k.b=m+1
if(!(m<q))return A.a(s,m)
s[m]=n&63|128}}}return o}}
A.da.prototype={
af(a){return new A.ei(this.a).bS(t.L.a(a),0,null,!0)}}
A.ei.prototype={
bS(a,b,c,d){var s,r,q,p,o,n,m,l=this
t.L.a(a)
s=A.az(b,c,J.a5(a))
if(b===s)return""
if(a instanceof Uint8Array){r=a
q=r
p=0}else{q=A.k4(a,b,s)
s-=b
p=b
b=0}if(s-b>=15){o=l.a
n=A.k3(o,q,b,s)
if(n!=null){if(!o)return n
if(n.indexOf("\ufffd")<0)return n}}n=l.aH(q,b,s,!0)
o=l.b
if((o&1)!==0){m=A.k5(o)
l.b=0
throw A.b(A.z(m,a,p+l.c))}return n},
aH(a,b,c,d){var s,r,q=this
if(c-b>1000){s=B.c.bm(b+c,2)
r=q.aH(a,b,s,!1)
if((q.b&1)!==0)return r
return r+q.aH(a,s,c,d)}return q.cd(a,b,c,d)},
cd(a,b,a0,a1){var s,r,q,p,o,n,m,l,k=this,j="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFFFFFFFFFFFFFFFFGGGGGGGGGGGGGGGGHHHHHHHHHHHHHHHHHHHHHHHHHHHIHHHJEEBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBKCCCCCCCCCCCCDCLONNNMEEEEEEEEEEE",i=" \x000:XECCCCCN:lDb \x000:XECCCCCNvlDb \x000:XECCCCCN:lDb AAAAA\x00\x00\x00\x00\x00AAAAA00000AAAAA:::::AAAAAGG000AAAAA00KKKAAAAAG::::AAAAA:IIIIAAAAA000\x800AAAAA\x00\x00\x00\x00 AAAAA",h=65533,g=k.b,f=k.c,e=new A.K(""),d=b+1,c=a.length
if(!(b>=0&&b<c))return A.a(a,b)
s=a[b]
A:for(r=k.a;;){for(;;d=o){if(!(s>=0&&s<256))return A.a(j,s)
q=j.charCodeAt(s)&31
f=g<=32?s&61694>>>q:(s&63|f<<6)>>>0
p=g+q
if(!(p>=0&&p<144))return A.a(i,p)
g=i.charCodeAt(p)
if(g===0){p=A.P(f)
e.a+=p
if(d===a0)break A
break}else if((g&1)!==0){if(r)switch(g){case 69:case 67:p=A.P(h)
e.a+=p
break
case 65:p=A.P(h)
e.a+=p;--d
break
default:p=A.P(h)
e.a=(e.a+=p)+p
break}else{k.b=g
k.c=d-1
return""}g=0}if(d===a0)break A
o=d+1
if(!(d>=0&&d<c))return A.a(a,d)
s=a[d]}o=d+1
if(!(d>=0&&d<c))return A.a(a,d)
s=a[d]
if(s<128){for(;;){if(!(o<a0)){n=a0
break}m=o+1
if(!(o>=0&&o<c))return A.a(a,o)
s=a[o]
if(s>=128){n=m-1
o=m
break}o=m}if(n-d<20)for(l=d;l<n;++l){if(!(l<c))return A.a(a,l)
p=A.P(a[l])
e.a+=p}else{p=A.fN(a,d,n)
e.a+=p}if(n===a0)break A
d=o}else d=o}if(a1&&g>32)if(r){c=A.P(h)
e.a+=c}else{k.b=77
k.c=a0
return""}k.b=g
k.c=f
c=e.a
return c.charCodeAt(0)==0?c:c}}
A.x.prototype={}
A.ch.prototype={
i(a){var s=this.a
if(s!=null)return"Assertion failed: "+A.dD(s)
return"Assertion failed"}}
A.bV.prototype={}
A.a6.prototype={
gaJ(){return"Invalid argument"+(!this.a?"(s)":"")},
gaI(){return""},
i(a){var s=this,r=s.c,q=r==null?"":" ("+r+")",p=s.d,o=p==null?"":": "+A.i(p),n=s.gaJ()+q+o
if(!s.a)return n
return n+s.gaI()+": "+A.dD(s.gb_())},
gb_(){return this.b}}
A.aj.prototype={
gb_(){return A.ho(this.b)},
gaJ(){return"RangeError"},
gaI(){var s,r=this.e,q=this.f
if(r==null)s=q!=null?": Not less than or equal to "+A.i(q):""
else if(q==null)s=": Not greater than or equal to "+A.i(r)
else if(q>r)s=": Not in inclusive range "+A.i(r)+".."+A.i(q)
else s=q<r?": Valid value range is empty":": Only valid value is "+A.i(r)
return s}}
A.bt.prototype={
gb_(){return A.bb(this.b)},
gaJ(){return"RangeError"},
gaI(){if(A.bb(this.b)<0)return": index must not be negative"
var s=this.f
if(s===0)return": no indices are valid"
return": index should be less than "+s},
$iaj:1,
gl(a){return this.f}}
A.bW.prototype={
i(a){return"Unsupported operation: "+this.a}}
A.d4.prototype={
i(a){return"UnimplementedError: "+this.a}}
A.aM.prototype={
i(a){return"Bad state: "+this.a}}
A.cn.prototype={
i(a){var s=this.a
if(s==null)return"Concurrent modification during iteration."
return"Concurrent modification during iteration: "+A.dD(s)+"."}}
A.cQ.prototype={
i(a){return"Out of Memory"},
$ix:1}
A.bR.prototype={
i(a){return"Stack Overflow"},
$ix:1}
A.D.prototype={
i(a){var s,r,q,p,o,n,m,l,k,j,i,h=this.a,g=""!==h?"FormatException: "+h:"FormatException",f=this.c,e=this.b
if(typeof e=="string"){if(f!=null)s=f<0||f>e.length
else s=!1
if(s)f=null
if(f==null){if(e.length>78)e=B.a.j(e,0,75)+"..."
return g+"\n"+e}for(r=e.length,q=1,p=0,o=!1,n=0;n<f;++n){if(!(n<r))return A.a(e,n)
m=e.charCodeAt(n)
if(m===10){if(p!==n||!o)++q
p=n+1
o=!1}else if(m===13){++q
p=n+1
o=!0}}g=q>1?g+(" (at line "+q+", character "+(f-p+1)+")\n"):g+(" (at character "+(f+1)+")\n")
for(n=f;n<r;++n){if(!(n>=0))return A.a(e,n)
m=e.charCodeAt(n)
if(m===10||m===13){r=n
break}}l=""
if(r-p>78){k="..."
if(f-p<75){j=p+75
i=p}else{if(r-f<75){i=r-75
j=r
k=""}else{i=f-36
j=f+36}l="..."}}else{j=r
i=p
k=""}return g+l+B.a.j(e,i,j)+k+"\n"+B.a.bc(" ",f-i+l.length)+"^\n"}else return f!=null?g+(" (at offset "+A.i(f)+")"):g},
$ibq:1}
A.d.prototype={
ar(a,b){return A.dt(this,A.t(this).h("d.E"),b)},
u(a,b){var s
for(s=this.gt(this);s.m();)if(J.as(s.gn(),b))return!0
return!1},
ab(a,b){var s=A.t(this).h("d.E")
if(b)s=A.cE(this,s)
else{s=A.cE(this,s)
s.$flags=1
s=s}return s},
bE(a){return this.ab(0,!0)},
gl(a){var s,r=this.gt(this)
for(s=0;r.m();)++s
return s},
gcl(a){return!this.gt(this).m()},
a4(a,b){return A.fP(this,b,A.t(this).h("d.E"))},
V(a,b){return A.jh(this,b,A.t(this).h("d.E"))},
gaR(a){var s=this.gt(this)
if(!s.m())throw A.b(A.b1())
return s.gn()},
gH(a){var s,r=this.gt(this)
if(!r.m())throw A.b(A.b1())
do s=r.gn()
while(r.m())
return s},
F(a,b){var s,r
A.Q(b,"index")
s=this.gt(this)
for(r=b;s.m();){if(r===0)return s.gn();--r}throw A.b(A.eI(b,b-r,this,"index"))},
i(a){return A.j2(this,"(",")")}}
A.bH.prototype={
gD(a){return A.r.prototype.gD.call(this,0)},
i(a){return"null"}}
A.r.prototype={$ir:1,
K(a,b){return this===b},
gD(a){return A.cT(this)},
i(a){return"Instance of '"+A.cU(this)+"'"},
gG(a){return A.bh(this)},
toString(){return this.i(this)}}
A.K.prototype={
gl(a){return this.a.length},
i(a){var s=this.a
return s.charCodeAt(0)==0?s:s},
$iji:1}
A.e7.prototype={
$2(a,b){throw A.b(A.z("Illegal IPv6 address, "+a,this.a,b))},
$S:13}
A.c7.prototype={
gbn(){var s,r,q,p,o=this,n=o.w
if(n===$){s=o.a
r=s.length!==0?s+":":""
q=o.c
p=q==null
if(!p||s==="file"){s=r+"//"
r=o.b
if(r.length!==0)s=s+r+"@"
if(!p)s+=q
r=o.d
if(r!=null)s=s+":"+A.i(r)}else s=r
s+=o.e
r=o.f
if(r!=null)s=s+"?"+r
r=o.r
if(r!=null)s=s+"#"+r
n=o.w=s.charCodeAt(0)==0?s:s}return n},
gb4(){var s,r,q,p=this,o=p.x
if(o===$){s=p.e
r=s.length
if(r!==0){if(0>=r)return A.a(s,0)
r=s.charCodeAt(0)===47}else r=!1
if(r)s=B.a.B(s,1)
q=s.length===0?B.t:A.a8(new A.y(A.f(s.split("/"),t.s),t.q.a(A.kQ()),t.r),t.N)
p.x!==$&&A.eE("pathSegments")
o=p.x=q}return o},
gD(a){var s,r=this,q=r.y
if(q===$){s=B.a.gD(r.gbn())
r.y!==$&&A.eE("hashCode")
r.y=s
q=s}return q},
gba(){return this.b},
ga1(){var s=this.c
if(s==null)return""
if(B.a.q(s,"[")&&!B.a.A(s,"v",1))return B.a.j(s,1,s.length-1)
return s},
gaj(){var s=this.d
return s==null?A.h9(this.a):s},
gak(){var s=this.f
return s==null?"":s},
gaw(){var s=this.r
return s==null?"":s},
cm(a){var s=this.a
if(a.length!==s.length)return!1
return A.ke(a,s,0)>=0},
bC(a){var s,r,q,p,o,n,m,l,k=this,j=k.a
if(a!=null){a=A.eh(a,0,a.length)
s=a!==j}else{a=j
s=!1}r=a==="file"
q=k.b
p=k.d
if(s)p=A.eg(p,a)
o=k.c
if(!(o!=null))o=q.length!==0||p!=null||r?"":null
n=k.e
if(!r)m=o!=null&&n.length!==0
else m=!0
if(m&&!B.a.q(n,"/"))n="/"+n
l=n
return A.c8(a,q,o,p,l,k.f,k.r)},
bj(a,b){var s,r,q,p,o,n,m,l,k
for(s=0,r=0;B.a.A(b,"../",r);){r+=3;++s}q=B.a.bx(a,"/")
p=a.length
for(;;){if(!(q>0&&s>0))break
o=B.a.by(a,"/",q-1)
if(o<0)break
n=q-o
m=n!==2
l=!1
if(!m||n===3){k=o+1
if(!(k<p))return A.a(a,k)
if(a.charCodeAt(k)===46)if(m){m=o+2
if(!(m<p))return A.a(a,m)
m=a.charCodeAt(m)===46}else m=!0
else m=l}else m=l
if(m)break;--s
q=o}return B.a.U(a,q+1,null,B.a.B(b,r-3*s))},
b7(a){return this.al(A.R(a))},
al(a){var s,r,q,p,o,n,m,l,k,j,i,h=this
if(a.gI().length!==0)return a
else{s=h.a
if(a.gaU()){r=a.bC(s)
return r}else{q=h.b
p=h.c
o=h.d
n=h.e
if(a.gbt())m=a.gaz()?a.gak():h.f
else{l=A.k1(h,n)
if(l>0){k=B.a.j(n,0,l)
n=a.gaT()?k+A.aR(a.gR()):k+A.aR(h.bj(B.a.B(n,k.length),a.gR()))}else if(a.gaT())n=A.aR(a.gR())
else if(n.length===0)if(p==null)n=s.length===0?a.gR():A.aR(a.gR())
else n=A.aR("/"+a.gR())
else{j=h.bj(n,a.gR())
r=s.length===0
if(!r||p!=null||B.a.q(n,"/"))n=A.aR(j)
else n=A.f_(j,!r||p!=null)}m=a.gaz()?a.gak():null}}}i=a.gaV()?a.gaw():null
return A.c8(s,q,p,o,n,m,i)},
gaU(){return this.c!=null},
gaz(){return this.f!=null},
gaV(){return this.r!=null},
gbt(){return this.e.length===0},
gaT(){return B.a.q(this.e,"/")},
b8(){var s,r=this,q=r.a
if(q!==""&&q!=="file")throw A.b(A.X("Cannot extract a file path from a "+q+" URI"))
q=r.f
if((q==null?"":q)!=="")throw A.b(A.X(u.y))
q=r.r
if((q==null?"":q)!=="")throw A.b(A.X(u.l))
if(r.c!=null&&r.ga1()!=="")A.a4(A.X(u.j))
s=r.gb4()
A.jU(s,!1)
q=A.eQ(B.a.q(r.e,"/")?"/":"",s,"/")
q=q.charCodeAt(0)==0?q:q
return q},
i(a){return this.gbn()},
K(a,b){var s,r,q,p=this
if(b==null)return!1
if(p===b)return!0
s=!1
if(t.R.b(b))if(p.a===b.gI())if(p.c!=null===b.gaU())if(p.b===b.gba())if(p.ga1()===b.ga1())if(p.gaj()===b.gaj())if(p.e===b.gR()){r=p.f
q=r==null
if(!q===b.gaz()){if(q)r=""
if(r===b.gak()){r=p.r
q=r==null
if(!q===b.gaV()){s=q?"":r
s=s===b.gaw()}}}}return s},
$ibX:1,
gI(){return this.a},
gR(){return this.e}}
A.ef.prototype={
$1(a){return A.k2(64,A.m(a),B.f,!1)},
$S:3}
A.d6.prototype={
gac(){var s,r,q,p,o=this,n=null,m=o.c
if(m==null){m=o.b
if(0>=m.length)return A.a(m,0)
s=o.a
m=m[0]+1
r=B.a.a2(s,"?",m)
q=s.length
if(r>=0){p=A.c9(s,r+1,q,256,!1,!1)
q=r}else p=n
m=o.c=new A.de("data","",n,n,A.c9(s,m,q,128,!1,!1),p,n)}return m},
i(a){var s,r=this.b
if(0>=r.length)return A.a(r,0)
s=this.a
return r[0]===-1?"data:"+s:s}}
A.a1.prototype={
gaU(){return this.c>0},
gaW(){return this.c>0&&this.d+1<this.e},
gaz(){return this.f<this.r},
gaV(){return this.r<this.a.length},
gaT(){return B.a.A(this.a,"/",this.e)},
gbt(){return this.e===this.f},
gI(){var s=this.w
return s==null?this.w=this.bR():s},
bR(){var s,r=this,q=r.b
if(q<=0)return""
s=q===4
if(s&&B.a.q(r.a,"http"))return"http"
if(q===5&&B.a.q(r.a,"https"))return"https"
if(s&&B.a.q(r.a,"file"))return"file"
if(q===7&&B.a.q(r.a,"package"))return"package"
return B.a.j(r.a,0,q)},
gba(){var s=this.c,r=this.b+3
return s>r?B.a.j(this.a,r,s-1):""},
ga1(){var s=this.c
return s>0?B.a.j(this.a,s,this.d):""},
gaj(){var s,r=this
if(r.gaW())return A.a3(B.a.j(r.a,r.d+1,r.e),null)
s=r.b
if(s===4&&B.a.q(r.a,"http"))return 80
if(s===5&&B.a.q(r.a,"https"))return 443
return 0},
gR(){return B.a.j(this.a,this.e,this.f)},
gak(){var s=this.f,r=this.r
return s<r?B.a.j(this.a,s+1,r):""},
gaw(){var s=this.r,r=this.a
return s<r.length?B.a.B(r,s+1):""},
gb4(){var s,r,q,p=this.e,o=this.f,n=this.a
if(B.a.A(n,"/",p))++p
if(p===o)return B.t
s=A.f([],t.s)
for(r=n.length,q=p;q<o;++q){if(!(q>=0&&q<r))return A.a(n,q)
if(n.charCodeAt(q)===47){B.b.k(s,B.a.j(n,p,q))
p=q+1}}B.b.k(s,B.a.j(n,p,o))
return A.a8(s,t.N)},
bh(a){var s=this.d+1
return s+a.length===this.e&&B.a.A(this.a,a,s)},
cr(){var s=this,r=s.r,q=s.a
if(r>=q.length)return s
return new A.a1(B.a.j(q,0,r),s.b,s.c,s.d,s.e,s.f,r,s.w)},
bC(a){var s,r,q,p,o,n,m,l,k,j,i,h=this,g=null
if(a!=null){a=A.eh(a,0,a.length)
s=!(h.b===a.length&&B.a.q(h.a,a))}else{a=h.gI()
s=!1}r=a==="file"
q=h.c
p=q>0?B.a.j(h.a,h.b+3,q):""
o=h.gaW()?h.gaj():g
if(s)o=A.eg(o,a)
q=h.c
if(q>0)n=B.a.j(h.a,q,h.d)
else n=p.length!==0||o!=null||r?"":g
q=h.a
m=h.f
l=B.a.j(q,h.e,m)
if(!r)k=n!=null&&l.length!==0
else k=!0
if(k&&!B.a.q(l,"/"))l="/"+l
k=h.r
j=m<k?B.a.j(q,m+1,k):g
m=h.r
i=m<q.length?B.a.B(q,m+1):g
return A.c8(a,p,n,o,l,j,i)},
b7(a){return this.al(A.R(a))},
al(a){if(a instanceof A.a1)return this.c6(this,a)
return this.bo().al(a)},
c6(a,b){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d,c=b.b
if(c>0)return b
s=b.c
if(s>0){r=a.b
if(r<=0)return b
q=r===4
if(q&&B.a.q(a.a,"file"))p=b.e!==b.f
else if(q&&B.a.q(a.a,"http"))p=!b.bh("80")
else p=!(r===5&&B.a.q(a.a,"https"))||!b.bh("443")
if(p){o=r+1
return new A.a1(B.a.j(a.a,0,o)+B.a.B(b.a,c+1),r,s+o,b.d+o,b.e+o,b.f+o,b.r+o,a.w)}else return this.bo().al(b)}n=b.e
c=b.f
if(n===c){s=b.r
if(c<s){r=a.f
o=r-c
return new A.a1(B.a.j(a.a,0,r)+B.a.B(b.a,c),a.b,a.c,a.d,a.e,c+o,s+o,a.w)}c=b.a
if(s<c.length){r=a.r
return new A.a1(B.a.j(a.a,0,r)+B.a.B(c,s),a.b,a.c,a.d,a.e,a.f,s+(r-s),a.w)}return a.cr()}s=b.a
if(B.a.A(s,"/",n)){m=a.e
l=A.h2(this)
k=l>0?l:m
o=k-n
return new A.a1(B.a.j(a.a,0,k)+B.a.B(s,n),a.b,a.c,a.d,m,c+o,b.r+o,a.w)}j=a.e
i=a.f
if(j===i&&a.c>0){while(B.a.A(s,"../",n))n+=3
o=j-n+1
return new A.a1(B.a.j(a.a,0,j)+"/"+B.a.B(s,n),a.b,a.c,a.d,j,c+o,b.r+o,a.w)}h=a.a
l=A.h2(this)
if(l>=0)g=l
else for(g=j;B.a.A(h,"../",g);)g+=3
f=0
for(;;){e=n+3
if(!(e<=c&&B.a.A(s,"../",n)))break;++f
n=e}for(r=h.length,d="";i>g;){--i
if(!(i>=0&&i<r))return A.a(h,i)
if(h.charCodeAt(i)===47){if(f===0){d="/"
break}--f
d="/"}}if(i===g&&a.b<=0&&!B.a.A(h,"/",j)){n-=f*3
d=""}o=i-n+d.length
return new A.a1(B.a.j(h,0,i)+d+B.a.B(s,n),a.b,a.c,a.d,j,c+o,b.r+o,a.w)},
b8(){var s,r=this,q=r.b
if(q>=0){s=!(q===4&&B.a.q(r.a,"file"))
q=s}else q=!1
if(q)throw A.b(A.X("Cannot extract a file path from a "+r.gI()+" URI"))
q=r.f
s=r.a
if(q<s.length){if(q<r.r)throw A.b(A.X(u.y))
throw A.b(A.X(u.l))}if(r.c<r.d)A.a4(A.X(u.j))
q=B.a.j(s,r.e,q)
return q},
gD(a){var s=this.x
return s==null?this.x=B.a.gD(this.a):s},
K(a,b){if(b==null)return!1
if(this===b)return!0
return t.R.b(b)&&this.a===b.i(0)},
bo(){var s=this,r=null,q=s.gI(),p=s.gba(),o=s.c>0?s.ga1():r,n=s.gaW()?s.gaj():r,m=s.a,l=s.f,k=B.a.j(m,s.e,l),j=s.r
l=l<j?s.gak():r
return A.c8(q,p,o,n,k,l,j<m.length?s.gaw():r)},
i(a){return this.a},
$ibX:1}
A.de.prototype={}
A.co.prototype={
bq(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o){var s=!1,r=this.a
if(r.E(a)>0)s=!r.P(a)
if(s)return a
s=this.b
return this.bw(A.hB("absolute",s==null?A.f7():s,a,b,c,d,e,f,g,h,i,j,k,l,m,n,o))},
Y(a){var s=null
return this.bq(a,s,s,s,s,s,s,s,s,s,s,s,s,s,s)},
cf(a){var s,r,q=A.aL(a,this.a)
q.aF()
s=q.d
r=s.length
if(r===0){s=q.b
return s==null?".":s}if(r===1){s=q.b
return s==null?".":s}B.b.b6(s)
s=q.e
if(0>=s.length)return A.a(s,-1)
s.pop()
q.aF()
return q.i(0)},
bw(a){var s,r,q,p,o,n,m,l,k,j
t._.a(a)
for(s=A.w(a),r=s.h("a_(1)").a(new A.dB()),q=B.b.gt(a),s=new A.aP(q,r,s.h("aP<1>")),r=this.a,p=!1,o=!1,n="";s.m();){m=q.gn()
if(r.P(m)&&o){l=A.aL(m,r)
k=n.charCodeAt(0)==0?n:n
n=B.a.j(k,0,r.aa(k,!0))
l.b=n
if(r.ai(n))B.b.v(l.e,0,r.ga5())
n=l.i(0)}else if(r.E(m)>0){o=!r.P(m)
n=m}else{j=m.length
if(j!==0){if(0>=j)return A.a(m,0)
j=r.aP(m[0])}else j=!1
if(!j)if(p)n+=r.ga5()
n+=m}p=r.ai(m)}return n.charCodeAt(0)==0?n:n},
ae(a,b){var s=A.aL(b,this.a),r=s.d,q=A.w(r),p=q.h("Y<1>")
r=A.cE(new A.Y(r,q.h("a_(1)").a(new A.dC()),p),p.h("d.E"))
s.sco(r)
r=s.b
if(r!=null)B.b.aY(s.d,0,r)
return s.d},
b3(a){var s
if(!this.c1(a))return a
s=A.aL(a,this.a)
s.b2()
return s.i(0)},
c1(a){var s,r,q,p,o,n,m=a.length
if(m===0)return!0
s=this.a
r=s.E(a)
if(r!==0){q=r-1
if(!(q>=0&&q<m))return A.a(a,q)
p=s.C(a.charCodeAt(q))?1:0
if(s===$.cd())for(o=0;o<r;++o){if(!(o<m))return A.a(a,o)
if(a.charCodeAt(o)===47)return!0}}else p=0
for(o=r;o<m;++o){if(!(o>=0))return A.a(a,o)
n=a.charCodeAt(o)
if(s.C(n)){if(p>=1&&p<6)return!0
if(s===$.cd()&&n===47)return!0
p=1}else if(n===46)p+=2
else{if(s===$.ar())q=n===63||n===35
else q=!1
if(q)return!0
p=6}}return p>=1&&p<6},
aD(a,b){var s,r,q,p,o,n,m,l=this,k='Unable to find a path to "',j=b==null
if(j&&l.a.E(a)<=0)return l.b3(a)
if(j){j=l.b
b=j==null?A.f7():j}else b=l.Y(b)
j=l.a
if(j.E(b)<=0&&j.E(a)>0)return l.b3(a)
if(j.E(a)<=0||j.P(a))a=l.Y(a)
if(j.E(a)<=0&&j.E(b)>0)throw A.b(A.fE(k+a+'" from "'+b+'".'))
s=A.aL(b,j)
s.b2()
r=A.aL(a,j)
r.b2()
q=s.d
p=q.length
if(p!==0){if(0>=p)return A.a(q,0)
q=q[0]==="."}else q=!1
if(q)return r.i(0)
q=s.b
p=r.b
if(q!=p)q=q==null||p==null||!j.b5(q,p)
else q=!1
if(q)return r.i(0)
for(;;){q=s.d
p=q.length
o=!1
if(p!==0){n=r.d
m=n.length
if(m!==0){if(0>=p)return A.a(q,0)
q=q[0]
if(0>=m)return A.a(n,0)
n=j.b5(q,n[0])
q=n}else q=o}else q=o
if(!q)break
B.b.aE(s.d,0)
B.b.aE(s.e,1)
B.b.aE(r.d,0)
B.b.aE(r.e,1)}q=s.d
p=q.length
if(p!==0){if(0>=p)return A.a(q,0)
q=q[0]===".."}else q=!1
if(q)throw A.b(A.fE(k+a+'" from "'+b+'".'))
q=t.N
B.b.aZ(r.d,0,A.aw(p,"..",!1,q))
B.b.v(r.e,0,"")
B.b.aZ(r.e,1,A.aw(s.d.length,j.ga5(),!1,q))
j=r.d
q=j.length
if(q===0)return"."
if(q>1&&B.b.gH(j)==="."){B.b.b6(r.d)
j=r.e
if(0>=j.length)return A.a(j,-1)
j.pop()
if(0>=j.length)return A.a(j,-1)
j.pop()
B.b.k(j,"")}r.b=""
r.aF()
return r.i(0)},
cq(a){return this.aD(a,null)},
bi(a,b){var s,r,q,p,o,n,m,l,k=this
a=A.m(a)
b=A.m(b)
r=k.a
q=r.E(A.m(a))>0
p=r.E(A.m(b))>0
if(q&&!p){b=k.Y(b)
if(r.P(a))a=k.Y(a)}else if(p&&!q){a=k.Y(a)
if(r.P(b))b=k.Y(b)}else if(p&&q){o=r.P(b)
n=r.P(a)
if(o&&!n)b=k.Y(b)
else if(n&&!o)a=k.Y(a)}m=k.c_(a,b)
if(m!==B.e)return m
s=null
try{s=k.aD(b,a)}catch(l){if(A.cc(l) instanceof A.bJ)return B.d
else throw l}if(r.E(A.m(s))>0)return B.d
if(J.as(s,"."))return B.o
if(J.as(s,".."))return B.d
return J.a5(s)>=3&&J.iG(s,"..")&&r.C(J.iC(s,2))?B.d:B.h},
c_(a,b){var s,r,q,p,o,n,m,l,k,j,i,h,g,f,e,d=this
if(a===".")a=""
s=d.a
r=s.E(a)
q=s.E(b)
if(r!==q)return B.d
for(p=a.length,o=b.length,n=0;n<r;++n){if(!(n<p))return A.a(a,n)
if(!(n<o))return A.a(b,n)
if(!s.au(a.charCodeAt(n),b.charCodeAt(n)))return B.d}m=q
l=r
k=47
j=null
for(;;){if(!(l<p&&m<o))break
A:{if(!(l>=0&&l<p))return A.a(a,l)
i=a.charCodeAt(l)
if(!(m>=0&&m<o))return A.a(b,m)
h=b.charCodeAt(m)
if(s.au(i,h)){if(s.C(i))j=l;++l;++m
k=i
break A}if(s.C(i)&&s.C(k)){g=l+1
j=l
l=g
break A}else if(s.C(h)&&s.C(k)){++m
break A}if(i===46&&s.C(k)){++l
if(l===p)break
if(!(l<p))return A.a(a,l)
i=a.charCodeAt(l)
if(s.C(i)){g=l+1
j=l
l=g
break A}if(i===46){++l
if(l!==p){if(!(l<p))return A.a(a,l)
f=s.C(a.charCodeAt(l))}else f=!0
if(f)return B.e}}if(h===46&&s.C(k)){++m
if(m===o)break
if(!(m<o))return A.a(b,m)
h=b.charCodeAt(m)
if(s.C(h)){++m
break A}if(h===46){++m
if(m!==o){if(!(m<o))return A.a(b,m)
p=s.C(b.charCodeAt(m))
s=p}else s=!0
if(s)return B.e}}if(d.an(b,m)!==B.l)return B.e
if(d.an(a,l)!==B.l)return B.e
return B.d}}if(m===o){if(l!==p){if(!(l>=0&&l<p))return A.a(a,l)
s=s.C(a.charCodeAt(l))}else s=!0
if(s)j=l
else if(j==null)j=Math.max(0,r-1)
e=d.an(a,j)
if(e===B.m)return B.o
return e===B.n?B.e:B.d}e=d.an(b,m)
if(e===B.m)return B.o
if(e===B.n)return B.e
if(!(m>=0&&m<o))return A.a(b,m)
return s.C(b.charCodeAt(m))||s.C(k)?B.h:B.d},
an(a,b){var s,r,q,p,o,n,m,l
for(s=a.length,r=this.a,q=b,p=0,o=!1;q<s;){for(;;){if(q<s){if(!(q>=0))return A.a(a,q)
n=r.C(a.charCodeAt(q))}else n=!1
if(!n)break;++q}if(q===s)break
m=q
for(;;){if(m<s){if(!(m>=0))return A.a(a,m)
n=!r.C(a.charCodeAt(m))}else n=!1
if(!n)break;++m}n=m-q
if(n===1){if(!(q>=0&&q<s))return A.a(a,q)
l=a.charCodeAt(q)===46}else l=!1
if(!l){l=!1
if(n===2){if(!(q>=0&&q<s))return A.a(a,q)
if(a.charCodeAt(q)===46){n=q+1
if(!(n<s))return A.a(a,n)
n=a.charCodeAt(n)===46}else n=l}else n=l
if(n){--p
if(p<0)break
if(p===0)o=!0}else ++p}if(m===s)break
q=m+1}if(p<0)return B.n
if(p===0)return B.m
if(o)return B.a6
return B.l},
bG(a){var s,r=null,q=this.a
if(q.E(a)<=0)return q.bB(a)
else{s=this.b
return q.aO(this.bw(A.hB("join",s==null?A.f7():s,a,r,r,r,r,r,r,r,r,r,r,r,r,r,r)))}},
cp(a){var s,r,q=this,p=A.f4(a)
if(p.gI()==="file"&&q.a===$.ar())return p.i(0)
else if(p.gI()!=="file"&&p.gI()!==""&&q.a!==$.ar())return p.i(0)
s=q.b3(q.a.aC(A.f4(p)))
r=q.cq(s)
return q.ae(0,r).length>q.ae(0,s).length?s:r}}
A.dB.prototype={
$1(a){return A.m(a)!==""},
$S:0}
A.dC.prototype={
$1(a){return A.m(a).length!==0},
$S:0}
A.b6.prototype={
i(a){return this.a}}
A.b7.prototype={
i(a){return this.a}}
A.dP.prototype={
gaX(){var s=this.d
if(s.length!==0)s=B.b.gH(s)===""||B.b.gH(this.e)!==""
else s=!1
return s},
aF(){var s,r,q=this
for(;;){s=q.d
if(!(s.length!==0&&B.b.gH(s)===""))break
B.b.b6(q.d)
s=q.e
if(0>=s.length)return A.a(s,-1)
s.pop()}s=q.e
r=s.length
if(r!==0)B.b.v(s,r-1,"")},
b2(){var s,r,q,p,o,n,m,l=this,k=A.f([],t.s),j=l.a
if(j===$.ar()&&l.d.length!==0){s=l.d
B.b.sH(s,A.la(B.b.gH(s)))}for(s=l.d,r=s.length,q=0,p=0;p<s.length;s.length===r||(0,A.fg)(s),++p){o=s[p]
if(!(o==="."||o===""))if(o===".."){n=k.length
if(n!==0){if(0>=n)return A.a(k,-1)
k.pop()}else ++q}else B.b.k(k,o)}if(l.b==null)B.b.aZ(k,0,A.aw(q,"..",!1,t.N))
if(k.length===0&&l.b==null)B.b.k(k,".")
l.d=k
l.e=A.aw(k.length+1,j.ga5(),!0,t.N)
m=l.b
s=m!=null
if(!s||k.length===0||!j.ai(m))B.b.v(l.e,0,"")
if(s)if(j===$.cd())l.b=A.a0(m,"/","\\")
l.aF()},
i(a){var s,r,q,p,o,n=this.b
n=n!=null?n:""
for(s=this.d,r=s.length,q=this.e,p=q.length,o=0;o<r;++o){if(!(o<p))return A.a(q,o)
n=n+q[o]+s[o]}n+=B.b.gH(q)
return n.charCodeAt(0)==0?n:n},
sco(a){this.d=t.h.a(a)}}
A.bJ.prototype={
i(a){return"PathException: "+this.a},
$ibq:1}
A.b0.prototype={
bH(a){var s,r=this.E(a)
if(r>0)return B.a.j(a,0,r)
if(this.P(a)){if(0>=a.length)return A.a(a,0)
s=a[0]}else s=null
return s},
bB(a){var s,r,q=null,p=a.length
if(p===0)return A.E(q,q,q,q)
s=A.eH(this).ae(0,a)
r=p-1
if(!(r>=0))return A.a(a,r)
if(this.C(a.charCodeAt(r)))B.b.k(s,"")
return A.E(q,q,s,q)},
au(a,b){return a===b},
b5(a,b){return a===b}}
A.dX.prototype={
i(a){return this.gb1()}}
A.cS.prototype={
aP(a){return B.a.u(a,"/")},
C(a){return a===47},
ai(a){var s,r=a.length
if(r!==0){s=r-1
if(!(s>=0))return A.a(a,s)
s=a.charCodeAt(s)!==47
r=s}else r=!1
return r},
aa(a,b){var s=a.length
if(s!==0){if(0>=s)return A.a(a,0)
s=a.charCodeAt(0)===47}else s=!1
if(s)return 1
return 0},
E(a){return this.aa(a,!1)},
P(a){return!1},
aC(a){var s
if(a.gI()===""||a.gI()==="file"){s=a.gR()
return A.f0(s,0,s.length,B.f,!1)}throw A.b(A.L("Uri "+a.i(0)+" must have scheme 'file:'."))},
aO(a){var s=A.aL(a,this),r=s.d
if(r.length===0)B.b.ca(r,A.f(["",""],t.s))
else if(s.gaX())B.b.k(s.d,"")
return A.E(null,null,s.d,"file")},
gb1(){return"posix"},
ga5(){return"/"}}
A.d8.prototype={
aP(a){return B.a.u(a,"/")},
C(a){return a===47},
ai(a){var s,r=a.length
if(r===0)return!1
s=r-1
if(!(s>=0))return A.a(a,s)
if(a.charCodeAt(s)!==47)return!0
return B.a.aQ(a,"://")&&this.E(a)===r},
aa(a,b){var s,r,q,p,o,n,m,l,k=a.length
if(k===0)return 0
if(b&&A.le(a))s=5
else{s=A.kT(a,0)
b=!1}r=s>0
q=r?A.kO(a,s):0
if(q===k)return q
if(!(q<k))return A.a(a,q)
p=a.charCodeAt(q)
if(p===47){o=q+1
if(b&&q>s){n=A.hE(a,o)
if(n>o)return n}if(q===0)return o
return q}if(q>s)return q
if(r){m=q
l=p
for(;;){if(!(l!==35&&l!==63&&l!==47))break;++m
if(m===k)break
if(!(m<k))return A.a(a,m)
l=a.charCodeAt(m)}return m}return 0},
E(a){return this.aa(a,!1)},
P(a){var s=a.length,r=!1
if(s!==0){if(0>=s)return A.a(a,0)
if(a.charCodeAt(0)===47)if(s>=2){if(1>=s)return A.a(a,1)
s=a.charCodeAt(1)!==47}else s=!0
else s=r}else s=r
return s},
aC(a){return a.i(0)},
bB(a){return A.R(a)},
aO(a){return A.R(a)},
gb1(){return"url"},
ga5(){return"/"}}
A.dc.prototype={
aP(a){return B.a.u(a,"/")},
C(a){return a===47||a===92},
ai(a){var s,r=a.length
if(r===0)return!1
s=r-1
if(!(s>=0))return A.a(a,s)
s=a.charCodeAt(s)
return!(s===47||s===92)},
aa(a,b){var s,r,q=a.length
if(q===0)return 0
if(0>=q)return A.a(a,0)
if(a.charCodeAt(0)===47)return 1
if(a.charCodeAt(0)===92){if(q>=2){if(1>=q)return A.a(a,1)
s=a.charCodeAt(1)!==92}else s=!0
if(s)return 1
r=B.a.a2(a,"\\",2)
if(r>0){r=B.a.a2(a,"\\",r+1)
if(r>0)return r}return q}if(q<3)return 0
if(!A.fc(a.charCodeAt(0)))return 0
if(a.charCodeAt(1)!==58)return 0
q=a.charCodeAt(2)
if(!(q===47||q===92))return 0
return 3},
E(a){return this.aa(a,!1)},
P(a){return this.E(a)===1},
aC(a){var s,r
if(a.gI()!==""&&a.gI()!=="file")throw A.b(A.L("Uri "+a.i(0)+" must have scheme 'file:'."))
s=a.gR()
if(a.ga1()===""){if(s.length>=3&&B.a.q(s,"/")&&A.hE(s,1)!==1)s=B.a.bD(s,"/","")}else s="\\\\"+a.ga1()+s
r=A.a0(s,"/","\\")
return A.f0(r,0,r.length,B.f,!1)},
aO(a){var s,r,q=A.aL(a,this),p=q.b
p.toString
if(B.a.q(p,"\\\\")){s=new A.Y(A.f(p.split("\\"),t.s),t.Q.a(new A.e8()),t.U)
B.b.aY(q.d,0,s.gH(0))
if(q.gaX())B.b.k(q.d,"")
return A.E(s.gaR(0),null,q.d,"file")}else{if(q.d.length===0||q.gaX())B.b.k(q.d,"")
p=q.d
r=q.b
r.toString
r=A.a0(r,"/","")
B.b.aY(p,0,A.a0(r,"\\",""))
return A.E(null,null,q.d,"file")}},
au(a,b){var s
if(a===b)return!0
if(a===47)return b===92
if(a===92)return b===47
if((a^b)!==32)return!1
s=a|32
return s>=97&&s<=122},
b5(a,b){var s,r,q
if(a===b)return!0
s=a.length
r=b.length
if(s!==r)return!1
for(q=0;q<s;++q){if(!(q<r))return A.a(b,q)
if(!this.au(a.charCodeAt(q),b.charCodeAt(q)))return!1}return!0},
gb1(){return"windows"},
ga5(){return"\\"}}
A.e8.prototype={
$1(a){return A.m(a)!==""},
$S:0}
A.ay.prototype={}
A.cG.prototype={
bM(a,b,c){var s,r,q,p,o,n,m,l,k,j,i,h
for(s=J.iB(a,t.f),r=s.$ti,s=new A.U(s,s.gl(0),r.h("U<k.E>")),q=this.c,p=this.a,o=this.b,n=t.a5,r=r.h("k.E");s.m();){m=s.d
if(m==null)m=r.a(m)
l=n.a(m.p(0,"offset"))
if(l==null)throw A.b(B.K)
k=A.f1(l.p(0,"line"))
if(k==null)throw A.b(B.M)
j=A.f1(l.p(0,"column"))
if(j==null)throw A.b(B.L)
B.b.k(p,k)
B.b.k(o,j)
i=A.dn(m.p(0,"url"))
h=n.a(m.p(0,"map"))
m=i!=null
if(m&&h!=null)throw A.b(B.I)
else if(m){m=A.z("section contains refers to "+i+', but no map was given for it. Make sure a map is passed in "otherMaps"',null,null)
throw A.b(m)}else if(h!=null)B.b.k(q,A.hK(h,c,b))
else throw A.b(B.N)}if(p.length===0)throw A.b(B.O)},
i(a){var s,r,q,p,o,n,m=this,l=A.bh(m).i(0)+" : ["
for(s=m.a,r=m.b,q=m.c,p=0;p<s.length;++p,l=n){o=s[p]
if(!(p<r.length))return A.a(r,p)
n=r[p]
if(!(p<q.length))return A.a(q,p)
n=l+"("+o+","+n+":"+q[p].i(0)+")"}l+="]"
return l.charCodeAt(0)==0?l:l}}
A.cF.prototype={
i(a){var s,r
for(s=this.a,s=new A.aJ(s,s.r,s.e,A.t(s).h("aJ<2>")),r="";s.m();)r+=s.d.i(0)
return r.charCodeAt(0)==0?r:r},
ad(a,b,c,d){var s,r,q,p,o,n,m,l
d=A.aX(d,"uri",t.N)
s=A.f([47,58],t.t)
for(r=d.length,q=this.a,p=!0,o=0;o<r;++o){if(p){n=B.a.B(d,o)
m=q.p(0,n)
if(m!=null)return m.ad(a,b,c,n)}p=B.b.u(s,d.charCodeAt(o))}l=A.eP(a*1e6+b,b,a,A.R(d))
return A.fL(l,l,"",!1)}}
A.bM.prototype={
bN(a4,a5){var s,r,q,p,o,n,m,l,k,j,i,h,g,f=this,e="sourcesContent",d=null,c=a4.a,b=a4.$ti.h("4?"),a=b.a(c.p(0,e))==null?B.T:A.dN(t.j.a(b.a(c.p(0,e))),!0,t.u),a0=f.c,a1=f.a,a2=t.t,a3=0
for(;;){s=a1.length
if(!(a3<s&&a3<a.length))break
A:{if(!(a3<a.length))return A.a(a,a3)
r=a[a3]
if(r==null)break A
if(!(a3<s))return A.a(a1,a3)
s=a1[a3]
q=A.f([0],a2)
p=A.R(s)
o=r.length
q=new A.cW(p,q,new Uint32Array(o))
q.bO(new A.bl(r),s)
B.b.v(a0,a3,q)}++a3}c=A.m(b.a(c.p(0,"mappings")))
b=c.length
n=new A.dj(c,b)
c=t.p
m=A.f([],c)
a0=b-1
b=b>0
a2=f.b
s=f.d
l=0
k=0
j=0
i=0
h=0
g=0
for(;;){if(!(n.c<a0&&b))break
B:{if(n.ga3().a){if(m.length!==0){B.b.k(s,new A.aA(l,m))
m=A.f([],c)}++l;++n.c
k=0
break B}if(n.ga3().b)throw A.b(f.aM(0,l))
k+=A.dp(n)
q=n.ga3()
if(!(!q.a&&!q.b&&!q.c))B.b.k(m,new A.am(k,d,d,d,d))
else{j+=A.dp(n)
if(j<0||j>=a1.length)throw A.b(A.d0("Invalid source url id. "+A.i(f.e)+", "+l+", "+j))
q=n.ga3()
if(!(!q.a&&!q.b&&!q.c))throw A.b(f.aM(2,l))
i+=A.dp(n)
q=n.ga3()
if(!(!q.a&&!q.b&&!q.c))throw A.b(f.aM(3,l))
h+=A.dp(n)
q=n.ga3()
if(!(!q.a&&!q.b&&!q.c))B.b.k(m,new A.am(k,j,i,h,d))
else{g+=A.dp(n)
if(g<0||g>=a2.length)throw A.b(A.d0("Invalid name id: "+A.i(f.e)+", "+l+", "+g))
B.b.k(m,new A.am(k,j,i,h,g))}}if(n.ga3().b)++n.c}}if(m.length!==0)B.b.k(s,new A.aA(l,m))
a4.a0(0,new A.dT(f))},
aM(a,b){return new A.aM("Invalid entry in sourcemap, expected 1, 4, or 5 values, but got "+a+".\ntargeturl: "+A.i(this.e)+", line: "+b)},
bX(a,b){var s,r,q,p,o=this.d,n=A.hD(o,new A.dU(a),t.e)
for(s=t.D;--n,n>=0;){if(!(n<o.length))return A.a(o,n)
r=o[n]
q=r.b
if(q.length===0)continue
if(r.a!==a)return B.b.gH(q)
p=A.hD(q,new A.dV(b),s)
if(p>0){o=p-1
if(!(o<q.length))return A.a(q,o)
return q[o]}}return null},
ad(a,b,c,d){var s,r,q,p,o,n,m,l=this,k=l.bX(a,b)
if(k==null)return null
s=k.b
if(s==null)return null
r=l.a
if(s>>>0!==s||s>=r.length)return A.a(r,s)
q=r[s]
r=l.f
if(r!=null)q=r+q
p=k.e
r=l.r
r=r==null?null:r.b7(q)
if(r==null)r=q
o=k.c
n=A.eP(0,k.d,o,r)
if(p!=null){r=l.b
if(p>>>0!==p||p>=r.length)return A.a(r,p)
r=r[p]
o=r.length
o=A.eP(n.b+o,n.d+o,n.c,n.a)
m=new A.bQ(n,o,r)
m.bd(n,o,r)
return m}else return A.fL(n,n,"",!1)},
i(a){var s=this,r=A.bh(s).i(0)+" : [targetUrl: "+A.i(s.e)+", sourceRoot: "+A.i(s.f)+", urls: "+A.i(s.a)+", names: "+A.i(s.b)+", lines: "+A.i(s.d)+"]"
return r.charCodeAt(0)==0?r:r}}
A.dT.prototype={
$2(a,b){A.m(a)
if(B.a.q(a,"x_"))this.a.w.v(0,a,b)},
$S:14}
A.dU.prototype={
$1(a){return t.e.a(a).a>this.a},
$S:15}
A.dV.prototype={
$1(a){return t.D.a(a).a>this.a},
$S:16}
A.aA.prototype={
i(a){return A.bh(this).i(0)+": "+this.a+" "+A.i(this.b)}}
A.am.prototype={
i(a){var s=this
return A.bh(s).i(0)+": ("+s.a+", "+A.i(s.b)+", "+A.i(s.c)+", "+A.i(s.d)+", "+A.i(s.e)+")"}}
A.dj.prototype={
m(){return++this.c<this.b},
gn(){var s=this.c,r=s>=0&&s<this.b,q=this.a
if(r){if(!(s>=0&&s<q.length))return A.a(q,s)
s=q[s]}else s=A.a4(new A.bt(q.length,!0,s,null,"Index out of range"))
return s},
gcj(){var s=this.b
return this.c<s-1&&s>0},
ga3(){var s,r,q
if(!this.gcj())return B.a8
s=this.a
r=this.c+1
if(!(r>=0&&r<s.length))return A.a(s,r)
q=s[r]
if(q===";")return B.aa
if(q===",")return B.a9
return B.a7},
i(a){var s,r,q,p,o,n,m=this,l=new A.K("")
for(s=m.a,r=s.length,q=0;q<m.c;++q){if(!(q<r))return A.a(s,q)
l.a+=s[q]}l.a+="\x1b[31m"
try{p=l
o=m.gn()
p.a+=o}catch(n){if(!t.G.b(A.cc(n)))throw n}l.a+="\x1b[0m"
for(q=m.c+1;q<r;++q){if(!(q>=0))return A.a(s,q)
l.a+=s[q]}l.a+=" ("+m.c+")"
s=l.a
return s.charCodeAt(0)==0?s:s},
$iq:1}
A.b8.prototype={}
A.bQ.prototype={}
A.eq.prototype={
$0(){var s,r=A.eM(t.N,t.S)
for(s=0;s<64;++s)r.v(0,u.n[s],s)
return r},
$S:17}
A.cW.prototype={
gl(a){return this.c.length},
bO(a,b){var s,r,q,p,o,n,m,l,k,j
for(s=this.c,r=s.length,q=a.a,p=q.length,o=s.$flags|0,n=this.b,m=0;m<r;++m){if(!(m<p))return A.a(q,m)
l=q.charCodeAt(m)
o&2&&A.H(s)
s[m]=l
if(l===13){k=m+1
if(k<p){if(!(k<p))return A.a(q,k)
j=q.charCodeAt(k)!==10}else j=!0
if(j)l=10}if(l===10)B.b.k(n,m+1)}}}
A.cX.prototype={
bs(a){var s=this.a
if(!s.K(0,a.gN()))throw A.b(A.L('Source URLs "'+s.i(0)+'" and "'+a.gN().i(0)+"\" don't match."))
return Math.abs(this.b-a.ga9())},
K(a,b){if(b==null)return!1
return t.cJ.b(b)&&this.a.K(0,b.gN())&&this.b===b.ga9()},
gD(a){var s=this.a
s=s.gD(s)
return s+this.b},
i(a){var s=this,r=A.bh(s).i(0)
return"<"+r+": "+s.b+" "+(s.a.i(0)+":"+(s.c+1)+":"+(s.d+1))+">"},
gN(){return this.a},
ga9(){return this.b},
gah(){return this.c},
gav(){return this.d}}
A.cY.prototype={
bd(a,b,c){var s,r=this.b,q=this.a
if(!r.gN().K(0,q.gN()))throw A.b(A.L('Source URLs "'+q.gN().i(0)+'" and  "'+r.gN().i(0)+"\" don't match."))
else if(r.ga9()<q.ga9())throw A.b(A.L("End "+r.i(0)+" must come after start "+q.i(0)+"."))
else{s=this.c
if(s.length!==q.bs(r))throw A.b(A.L('Text "'+s+'" must be '+q.bs(r)+" characters long."))}},
gJ(){return this.a},
gM(){return this.b},
gcs(){return this.c}}
A.cZ.prototype={
gN(){return this.gJ().gN()},
gl(a){return this.gM().ga9()-this.gJ().ga9()},
K(a,b){if(b==null)return!1
return t.cx.b(b)&&this.gJ().K(0,b.gJ())&&this.gM().K(0,b.gM())},
gD(a){return A.fD(this.gJ(),this.gM(),B.j)},
i(a){var s=this
return"<"+A.bh(s).i(0)+": from "+s.gJ().i(0)+" to "+s.gM().i(0)+' "'+s.gcs()+'">'},
$idW:1}
A.at.prototype={
bF(){var s=this.a,r=A.w(s)
return A.eR(new A.br(s,r.h("d<l>(1)").a(new A.dA()),r.h("br<1,l>")),null)},
i(a){var s=this.a,r=A.w(s)
return new A.y(s,r.h("e(1)").a(new A.dy(new A.y(s,r.h("c(1)").a(new A.dz()),r.h("y<1,c>")).aS(0,0,B.i,t.S))),r.h("y<1,e>")).Z(0,u.q)},
$id_:1}
A.dv.prototype={
$1(a){return A.m(a).length!==0},
$S:0}
A.dA.prototype={
$1(a){return t.a.a(a).ga7()},
$S:18}
A.dz.prototype={
$1(a){var s=t.a.a(a).ga7(),r=A.w(s)
return new A.y(s,r.h("c(1)").a(new A.dx()),r.h("y<1,c>")).aS(0,0,B.i,t.S)},
$S:19}
A.dx.prototype={
$1(a){return t.B.a(a).ga8().length},
$S:5}
A.dy.prototype={
$1(a){var s=t.a.a(a).ga7(),r=A.w(s)
return new A.y(s,r.h("e(1)").a(new A.dw(this.a)),r.h("y<1,e>")).aA(0)},
$S:20}
A.dw.prototype={
$1(a){t.B.a(a)
return B.a.bA(a.ga8(),this.a)+"  "+A.i(a.gaB())+"\n"},
$S:6}
A.l.prototype={
gb0(){var s=this.a
if(s.gI()==="data")return"data:..."
return $.eF().cp(s)},
ga8(){var s,r=this,q=r.b
if(q==null)return r.gb0()
s=r.c
if(s==null)return r.gb0()+" "+A.i(q)
return r.gb0()+" "+A.i(q)+":"+A.i(s)},
i(a){return this.ga8()+" in "+A.i(this.d)},
gac(){return this.a},
gah(){return this.b},
gav(){return this.c},
gaB(){return this.d}}
A.dJ.prototype={
$0(){var s,r,q,p,o,n,m,l=null,k=this.a
if(k==="...")return new A.l(A.E(l,l,l,l),l,l,"...")
s=$.it().S(k)
if(s==null)return new A.af(A.E(l,"unparsed",l,l),k)
k=s.b
if(1>=k.length)return A.a(k,1)
r=k[1]
r.toString
q=$.i9()
r=A.a0(r,q,"<async>")
p=A.a0(r,"<anonymous closure>","<fn>")
if(2>=k.length)return A.a(k,2)
r=k[2]
q=r
q.toString
if(B.a.q(q,"<data:"))o=A.fV("")
else{r=r
r.toString
o=A.R(r)}if(3>=k.length)return A.a(k,3)
n=k[3].split(":")
k=n.length
m=k>1?A.a3(n[1],l):l
return new A.l(o,m,k>2?A.a3(n[2],l):l,p)},
$S:1}
A.dH.prototype={
$0(){var s,r,q,p,o,n,m="<fn>",l=this.a,k=$.is().S(l)
if(k!=null){s=k.W("member")
l=k.W("uri")
l.toString
r=A.cr(l)
l=k.W("index")
l.toString
q=k.W("offset")
q.toString
p=A.a3(q,16)
if(!(s==null))l=s
return new A.l(r,1,p+1,l)}k=$.io().S(l)
if(k!=null){l=new A.dI(l)
q=k.b
o=q.length
if(2>=o)return A.a(q,2)
n=q[2]
if(n!=null){o=n
o.toString
q=q[1]
q.toString
q=A.a0(q,"<anonymous>",m)
q=A.a0(q,"Anonymous function",m)
return l.$2(o,A.a0(q,"(anonymous function)",m))}else{if(3>=o)return A.a(q,3)
q=q[3]
q.toString
return l.$2(q,m)}}return new A.af(A.E(null,"unparsed",null,null),l)},
$S:1}
A.dI.prototype={
$2(a,b){var s,r,q,p,o,n=null,m=$.im(),l=m.S(a)
for(;l!=null;a=s){s=l.b
if(1>=s.length)return A.a(s,1)
s=s[1]
s.toString
l=m.S(s)}if(a==="native")return new A.l(A.R("native"),n,n,b)
r=$.ip().S(a)
if(r==null)return new A.af(A.E(n,"unparsed",n,n),this.a)
m=r.b
if(1>=m.length)return A.a(m,1)
s=m[1]
s.toString
q=A.cr(s)
if(2>=m.length)return A.a(m,2)
s=m[2]
s.toString
p=A.a3(s,n)
if(3>=m.length)return A.a(m,3)
o=m[3]
return new A.l(q,p,o!=null?A.a3(o,n):n,b)},
$S:21}
A.dE.prototype={
$0(){var s,r,q,p,o=null,n=this.a,m=$.ib().S(n)
if(m==null)return new A.af(A.E(o,"unparsed",o,o),n)
n=m.b
if(1>=n.length)return A.a(n,1)
s=n[1]
s.toString
r=A.a0(s,"/<","")
if(2>=n.length)return A.a(n,2)
s=n[2]
s.toString
q=A.cr(s)
if(3>=n.length)return A.a(n,3)
n=n[3]
n.toString
p=A.a3(n,o)
return new A.l(q,p,o,r.length===0||r==="anonymous"?"<fn>":r)},
$S:1}
A.dF.prototype={
$0(){var s,r,q,p,o,n,m,l,k=null,j=this.a,i=$.id().S(j)
if(i!=null){s=i.b
if(3>=s.length)return A.a(s,3)
r=s[3]
q=r
q.toString
if(B.a.u(q," line "))return A.iS(j)
j=r
j.toString
p=A.cr(j)
j=s.length
if(1>=j)return A.a(s,1)
o=s[1]
if(o!=null){if(2>=j)return A.a(s,2)
j=s[2]
j.toString
o+=B.b.aA(A.aw(B.a.ap("/",j).gl(0),".<fn>",!1,t.N))
if(o==="")o="<fn>"
o=B.a.bD(o,$.ij(),"")}else o="<fn>"
if(4>=s.length)return A.a(s,4)
j=s[4]
if(j==="")n=k
else{j=j
j.toString
n=A.a3(j,k)}if(5>=s.length)return A.a(s,5)
j=s[5]
if(j==null||j==="")m=k
else{j=j
j.toString
m=A.a3(j,k)}return new A.l(p,n,m,o)}i=$.ig().S(j)
if(i!=null){j=i.W("member")
j.toString
s=i.W("uri")
s.toString
p=A.cr(s)
s=i.W("index")
s.toString
r=i.W("offset")
r.toString
l=A.a3(r,16)
if(!(j.length!==0))j=s
return new A.l(p,1,l+1,j)}i=$.ik().S(j)
if(i!=null){j=i.W("member")
j.toString
return new A.l(A.E(k,"wasm code",k,k),k,k,j)}return new A.af(A.E(k,"unparsed",k,k),j)},
$S:1}
A.dG.prototype={
$0(){var s,r,q,p,o=null,n=this.a,m=$.ih().S(n)
if(m==null)throw A.b(A.z("Couldn't parse package:stack_trace stack trace line '"+n+"'.",o,o))
n=m.b
if(1>=n.length)return A.a(n,1)
s=n[1]
if(s==="data:...")r=A.fV("")
else{s=s
s.toString
r=A.R(s)}if(r.gI()===""){s=$.eF()
r=s.bG(s.bq(s.a.aC(A.f4(r)),o,o,o,o,o,o,o,o,o,o,o,o,o,o))}if(2>=n.length)return A.a(n,2)
s=n[2]
if(s==null)q=o
else{s=s
s.toString
q=A.a3(s,o)}if(3>=n.length)return A.a(n,3)
s=n[3]
if(s==null)p=o
else{s=s
s.toString
p=A.a3(s,o)}if(4>=n.length)return A.a(n,4)
return new A.l(r,q,p,n[4])},
$S:1}
A.cD.prototype={
gbp(){var s,r=this,q=r.b
if(q===$){s=r.a.$0()
r.b!==$&&A.eE("_trace")
r.b=s
q=s}return q},
ga7(){return this.gbp().ga7()},
i(a){return this.gbp().i(0)},
$id_:1,
$iu:1}
A.u.prototype={
i(a){var s=this.a,r=A.w(s)
return new A.y(s,r.h("e(1)").a(new A.e3(new A.y(s,r.h("c(1)").a(new A.e4()),r.h("y<1,c>")).aS(0,0,B.i,t.S))),r.h("y<1,e>")).aA(0)},
$id_:1,
ga7(){return this.a}}
A.e1.prototype={
$0(){return A.eS(this.a.i(0))},
$S:22}
A.e2.prototype={
$1(a){return A.m(a).length!==0},
$S:0}
A.e0.prototype={
$1(a){return!B.a.q(A.m(a),$.ir())},
$S:0}
A.e_.prototype={
$1(a){return A.m(a)!=="\tat "},
$S:0}
A.dY.prototype={
$1(a){A.m(a)
return a.length!==0&&a!=="[native code]"},
$S:0}
A.dZ.prototype={
$1(a){return!B.a.q(A.m(a),"=====")},
$S:0}
A.e4.prototype={
$1(a){return t.B.a(a).ga8().length},
$S:5}
A.e3.prototype={
$1(a){t.B.a(a)
if(a instanceof A.af)return a.i(0)+"\n"
return B.a.bA(a.ga8(),this.a)+"  "+A.i(a.gaB())+"\n"},
$S:6}
A.af.prototype={
i(a){return this.w},
$il:1,
gac(){return this.a},
gah(){return null},
gav(){return null},
ga8(){return"unparsed"},
gaB(){return this.w}}
A.eC.prototype={
$1(a){var s,r,q,p,o,n,m,l,k,j,i="dart:"
t.B.a(a)
if(a.gah()==null)return null
s=a.gav()
if(s==null)s=0
r=a.gah()
r.toString
q=this.a.bJ(r-1,s-1,a.gac().i(0))
if(q==null)return null
p=q.gN().i(0)
for(r=J.ac(this.b);r.m();){o=r.gn()
if(o!=null&&$.fk().bi(o,p)===B.h){n=$.fk()
m=n.aD(p,o)
if(B.a.u(m,i)){p=B.a.B(m,B.a.ag(m,i))
break}l=o+"/packages"
if(n.bi(l,p)===B.h){k="package:"+n.aD(p,l)
p=k
break}}}r=A.R(!B.a.q(p,i)&&!B.a.q(p,"package:")&&B.a.u(p,"dart_sdk")?"dart:sdk_internal":p)
o=q.gJ().gah()
n=q.gJ().gav()
j=a.gaB()
j.toString
return new A.l(r,o+1,n+1,A.kE(j))},
$S:23}
A.es.prototype={
$1(a){return A.P(A.a3(B.a.j(this.a,a.gJ()+1,a.gM()),null))},
$S:7}
A.cC.prototype={
ad(a,b,c,d){var s,r,q,p,o,n,m=null
if(d==null)throw A.b(A.fn("uri"))
s=this.a
r=s.a
if(!r.O(d)){q=this.b.$1(d)
if(q!=null){p=t.E.a(A.hK(t.f.a(B.F.cc(typeof q==="string"?A.m(q):A.m(v.G.JSON.stringify(q)),m)),m,m))
p.e=d
p.f=$.eF().cf(d)+"/"
r.v(0,A.aX(p.e,"mapping.targetUrl",t.N),p)}}o=s.ad(a,b,c,d)
s=o==null
if(!s)o.gJ().gN()
if(s)return m
n=o.gJ().gN().gb4()
if(n.length!==0&&B.b.gH(n)==="null")return m
return o},
bJ(a,b,c){return this.ad(a,b,null,c)}}
A.eD.prototype={
$1(a){return this.a.call(null,A.m(a))},
$S:24};(function aliases(){var s=J.av.prototype
s.bK=s.i
s=A.k.prototype
s.bL=s.a6})();(function installTearOffs(){var s=hunkHelpers._static_1,r=hunkHelpers.installStaticTearOff
s(A,"kB","kC",7)
s(A,"kQ","jz",3)
s(A,"kW","iZ",2)
s(A,"hF","iY",2)
s(A,"kU","iW",2)
s(A,"kV","iX",2)
s(A,"lo","jq",8)
s(A,"ln","jp",8)
s(A,"lc","l8",3)
s(A,"ld","lb",25)
r(A,"l9",2,null,["$1$2","$2"],["hI",function(a,b){return A.hI(a,b,t.H)}],26,0)})();(function inheritance(){var s=hunkHelpers.mixin,r=hunkHelpers.inherit,q=hunkHelpers.inheritMany
r(A.r,null)
q(A.r,[A.eK,J.ct,A.bL,J.aE,A.d,A.bk,A.F,A.M,A.x,A.k,A.dS,A.U,A.bB,A.aP,A.bs,A.bU,A.bN,A.bP,A.bp,A.bG,A.N,A.aO,A.e5,A.cP,A.dL,A.bA,A.aJ,A.au,A.b5,A.bY,A.bS,A.dl,A.a9,A.dg,A.eb,A.ag,A.ah,A.el,A.ei,A.cQ,A.bR,A.D,A.bH,A.K,A.c7,A.d6,A.a1,A.co,A.b6,A.b7,A.dP,A.bJ,A.dX,A.ay,A.aA,A.am,A.dj,A.b8,A.cZ,A.cW,A.cX,A.at,A.l,A.cD,A.u,A.af])
q(J.ct,[J.cv,J.bv,J.bx,J.bw,J.by,J.cx,J.aH])
q(J.bx,[J.av,J.v,A.b2,A.bD])
q(J.av,[J.cR,J.b3,J.ad])
r(J.cu,A.bL)
r(J.dK,J.v)
q(J.cx,[J.bu,J.cw])
q(A.d,[A.aB,A.h,A.V,A.Y,A.br,A.aN,A.ak,A.bO,A.bF,A.dd,A.dk])
q(A.aB,[A.aF,A.ca])
r(A.c_,A.aF)
r(A.bZ,A.ca)
r(A.a7,A.bZ)
q(A.F,[A.aG,A.bz,A.dh])
q(A.M,[A.cm,A.cs,A.cl,A.d3,A.ex,A.ez,A.ef,A.dB,A.dC,A.e8,A.dU,A.dV,A.dv,A.dA,A.dz,A.dx,A.dy,A.dw,A.e2,A.e0,A.e_,A.dY,A.dZ,A.e4,A.e3,A.eC,A.es,A.eD])
q(A.cm,[A.du,A.ey,A.dO,A.e7,A.dT,A.dI])
q(A.x,[A.cB,A.bV,A.cy,A.d5,A.cV,A.df,A.ch,A.a6,A.bW,A.d4,A.aM,A.cn])
r(A.b4,A.k)
r(A.bl,A.b4)
q(A.h,[A.I,A.bo,A.aI,A.dM])
q(A.I,[A.bT,A.y,A.di])
r(A.bm,A.V)
r(A.bn,A.aN)
r(A.aZ,A.ak)
r(A.b_,A.cs)
r(A.bI,A.bV)
q(A.d3,[A.d1,A.aY])
q(A.bD,[A.cH,A.J])
q(A.J,[A.c0,A.c2])
r(A.c1,A.c0)
r(A.bC,A.c1)
r(A.c3,A.c2)
r(A.W,A.c3)
q(A.bC,[A.cI,A.cJ])
q(A.W,[A.cK,A.cL,A.cM,A.cN,A.cO,A.bE,A.aK])
r(A.b9,A.df)
q(A.cl,[A.ek,A.ej,A.eq,A.dJ,A.dH,A.dE,A.dF,A.dG,A.e1])
q(A.ag,[A.cp,A.cj,A.e9,A.cz])
q(A.cp,[A.cf,A.d9])
q(A.ah,[A.dm,A.ck,A.cA,A.db,A.da])
r(A.cg,A.dm)
q(A.a6,[A.aj,A.bt])
r(A.de,A.c7)
r(A.b0,A.dX)
q(A.b0,[A.cS,A.d8,A.dc])
q(A.ay,[A.cG,A.cF,A.bM,A.cC])
r(A.cY,A.cZ)
r(A.bQ,A.cY)
s(A.b4,A.aO)
s(A.ca,A.k)
s(A.c0,A.k)
s(A.c1,A.N)
s(A.c2,A.k)
s(A.c3,A.N)})()
var v={G:typeof self!="undefined"?self:globalThis,typeUniverse:{eC:new Map(),tR:{},eT:{},tPV:{},sEA:[]},mangledGlobalNames:{c:"int",n:"double",aq:"num",e:"String",a_:"bool",bH:"Null",j:"List",r:"Object",ax:"Map",A:"JSObject"},mangledNames:{},types:["a_(e)","l()","l(e)","e(e)","@()","c(l)","e(l)","e(ae)","u(e)","@(@)","@(@,e)","@(e)","~(r?,r?)","0&(e,c?)","~(e,@)","a_(aA)","a_(am)","ax<e,c>()","j<l>(u)","c(u)","e(u)","l(e,e)","u()","l?(l)","r?(e)","~(ad)","0^(0^,0^)<aq>"],interceptorsByTag:null,leafTags:null,arrayRti:Symbol("$ti")}
A.jP(v.typeUniverse,JSON.parse('{"ad":"av","cR":"av","b3":"av","lv":"b2","v":{"j":["1"],"h":["1"],"A":[],"d":["1"]},"cv":{"a_":[],"p":[]},"bv":{"p":[]},"bx":{"A":[]},"av":{"A":[]},"cu":{"bL":[]},"dK":{"v":["1"],"j":["1"],"h":["1"],"A":[],"d":["1"]},"aE":{"q":["1"]},"cx":{"n":[],"aq":[]},"bu":{"n":[],"c":[],"aq":[],"p":[]},"cw":{"n":[],"aq":[],"p":[]},"aH":{"e":[],"dQ":[],"p":[]},"aB":{"d":["2"]},"bk":{"q":["2"]},"aF":{"aB":["1","2"],"d":["2"],"d.E":"2"},"c_":{"aF":["1","2"],"aB":["1","2"],"h":["2"],"d":["2"],"d.E":"2"},"bZ":{"k":["2"],"j":["2"],"aB":["1","2"],"h":["2"],"d":["2"]},"a7":{"bZ":["1","2"],"k":["2"],"j":["2"],"aB":["1","2"],"h":["2"],"d":["2"],"k.E":"2","d.E":"2"},"aG":{"F":["3","4"],"ax":["3","4"],"F.K":"3","F.V":"4"},"cB":{"x":[]},"bl":{"k":["c"],"aO":["c"],"j":["c"],"h":["c"],"d":["c"],"k.E":"c","aO.E":"c"},"h":{"d":["1"]},"I":{"h":["1"],"d":["1"]},"bT":{"I":["1"],"h":["1"],"d":["1"],"I.E":"1","d.E":"1"},"U":{"q":["1"]},"V":{"d":["2"],"d.E":"2"},"bm":{"V":["1","2"],"h":["2"],"d":["2"],"d.E":"2"},"bB":{"q":["2"]},"y":{"I":["2"],"h":["2"],"d":["2"],"I.E":"2","d.E":"2"},"Y":{"d":["1"],"d.E":"1"},"aP":{"q":["1"]},"br":{"d":["2"],"d.E":"2"},"bs":{"q":["2"]},"aN":{"d":["1"],"d.E":"1"},"bn":{"aN":["1"],"h":["1"],"d":["1"],"d.E":"1"},"bU":{"q":["1"]},"ak":{"d":["1"],"d.E":"1"},"aZ":{"ak":["1"],"h":["1"],"d":["1"],"d.E":"1"},"bN":{"q":["1"]},"bO":{"d":["1"],"d.E":"1"},"bP":{"q":["1"]},"bo":{"h":["1"],"d":["1"],"d.E":"1"},"bp":{"q":["1"]},"bF":{"d":["1"],"d.E":"1"},"bG":{"q":["1"]},"b4":{"k":["1"],"aO":["1"],"j":["1"],"h":["1"],"d":["1"]},"cs":{"M":[],"ai":[]},"b_":{"M":[],"ai":[]},"bI":{"x":[]},"cy":{"x":[]},"d5":{"x":[]},"cP":{"bq":[]},"M":{"ai":[]},"cl":{"M":[],"ai":[]},"cm":{"M":[],"ai":[]},"d3":{"M":[],"ai":[]},"d1":{"M":[],"ai":[]},"aY":{"M":[],"ai":[]},"cV":{"x":[]},"bz":{"F":["1","2"],"ax":["1","2"],"F.K":"1","F.V":"2"},"aI":{"h":["1"],"d":["1"],"d.E":"1"},"bA":{"q":["1"]},"dM":{"h":["1"],"d":["1"],"d.E":"1"},"aJ":{"q":["1"]},"au":{"je":[],"dQ":[]},"b5":{"bK":[],"ae":[]},"dd":{"d":["bK"],"d.E":"bK"},"bY":{"q":["bK"]},"bS":{"ae":[]},"dk":{"d":["ae"],"d.E":"ae"},"dl":{"q":["ae"]},"b2":{"A":[],"p":[]},"bD":{"A":[]},"cH":{"A":[],"p":[]},"J":{"T":["1"],"A":[]},"bC":{"k":["n"],"J":["n"],"j":["n"],"T":["n"],"h":["n"],"A":[],"d":["n"],"N":["n"]},"W":{"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"]},"cI":{"k":["n"],"J":["n"],"j":["n"],"T":["n"],"h":["n"],"A":[],"d":["n"],"N":["n"],"p":[],"k.E":"n"},"cJ":{"k":["n"],"J":["n"],"j":["n"],"T":["n"],"h":["n"],"A":[],"d":["n"],"N":["n"],"p":[],"k.E":"n"},"cK":{"W":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"cL":{"W":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"cM":{"W":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"cN":{"W":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"cO":{"W":[],"eT":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"bE":{"W":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"aK":{"W":[],"eU":[],"k":["c"],"J":["c"],"j":["c"],"T":["c"],"h":["c"],"A":[],"d":["c"],"N":["c"],"p":[],"k.E":"c"},"df":{"x":[]},"b9":{"x":[]},"k":{"j":["1"],"h":["1"],"d":["1"]},"F":{"ax":["1","2"]},"dh":{"F":["e","@"],"ax":["e","@"],"F.K":"e","F.V":"@"},"di":{"I":["e"],"h":["e"],"d":["e"],"I.E":"e","d.E":"e"},"cf":{"ag":["e","j<c>"]},"dm":{"ah":["e","j<c>"]},"cg":{"ah":["e","j<c>"]},"cj":{"ag":["j<c>","e"]},"ck":{"ah":["j<c>","e"]},"e9":{"ag":["1","3"]},"cp":{"ag":["e","j<c>"]},"cz":{"ag":["r?","e"]},"cA":{"ah":["e","r?"]},"d9":{"ag":["e","j<c>"]},"db":{"ah":["e","j<c>"]},"da":{"ah":["j<c>","e"]},"n":{"aq":[]},"c":{"aq":[]},"j":{"h":["1"],"d":["1"]},"bK":{"ae":[]},"e":{"dQ":[]},"ch":{"x":[]},"bV":{"x":[]},"a6":{"x":[]},"aj":{"x":[]},"bt":{"aj":[],"x":[]},"bW":{"x":[]},"d4":{"x":[]},"aM":{"x":[]},"cn":{"x":[]},"cQ":{"x":[]},"bR":{"x":[]},"D":{"bq":[]},"K":{"ji":[]},"c7":{"bX":[]},"a1":{"bX":[]},"de":{"bX":[]},"bJ":{"bq":[]},"cS":{"b0":[]},"d8":{"b0":[]},"dc":{"b0":[]},"bM":{"ay":[]},"cG":{"ay":[]},"cF":{"ay":[]},"dj":{"q":["e"]},"bQ":{"dW":[]},"cY":{"dW":[]},"cZ":{"dW":[]},"at":{"d_":[]},"cD":{"u":[],"d_":[]},"u":{"d_":[]},"af":{"l":[]},"cC":{"ay":[]},"j1":{"j":["c"],"h":["c"],"d":["c"]},"eU":{"j":["c"],"h":["c"],"d":["c"]},"jt":{"j":["c"],"h":["c"],"d":["c"]},"j_":{"j":["c"],"h":["c"],"d":["c"]},"js":{"j":["c"],"h":["c"],"d":["c"]},"j0":{"j":["c"],"h":["c"],"d":["c"]},"eT":{"j":["c"],"h":["c"],"d":["c"]},"iQ":{"j":["n"],"h":["n"],"d":["n"]},"iR":{"j":["n"],"h":["n"],"d":["n"]}}'))
A.jO(v.typeUniverse,JSON.parse('{"b4":1,"ca":2,"J":1}'))
var u={v:"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\u03f6\x00\u0404\u03f4 \u03f4\u03f6\u01f6\u01f6\u03f6\u03fc\u01f4\u03ff\u03ff\u0584\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u05d4\u01f4\x00\u01f4\x00\u0504\u05c4\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u0400\x00\u0400\u0200\u03f7\u0200\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u03ff\u0200\u0200\u0200\u03f7\x00",q:"===== asynchronous gap ===========================\n",n:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",l:"Cannot extract a file path from a URI with a fragment component",y:"Cannot extract a file path from a URI with a query component",j:"Cannot extract a non-Windows file path from a file URI with an authority"}
var t=(function rtii(){var s=A.bf
return{X:s("h<@>"),C:s("x"),W:s("bq"),B:s("l"),d:s("l(e)"),Z:s("ai"),_:s("d<e>"),c:s("d<@>"),Y:s("d<c>"),F:s("v<l>"),o:s("v<ay>"),s:s("v<e>"),p:s("v<am>"),l:s("v<aA>"),J:s("v<u>"),b:s("v<@>"),t:s("v<c>"),T:s("bv"),m:s("A"),g:s("ad"),v:s("T<@>"),h:s("j<e>"),j:s("j<@>"),L:s("j<c>"),f:s("ax<@,@>"),M:s("V<e,l>"),x:s("y<e,u>"),r:s("y<e,@>"),cu:s("W"),cr:s("aK"),cK:s("bF<l>"),P:s("bH"),K:s("r"),G:s("aj"),cY:s("lw"),k:s("bK"),E:s("bM"),cN:s("bO<e>"),cJ:s("cX"),cx:s("dW"),N:s("e"),bj:s("e(ae)"),D:s("am"),e:s("aA"),a:s("u"),cQ:s("u(e)"),bW:s("p"),cB:s("b3"),R:s("bX"),U:s("Y<e>"),y:s("a_"),Q:s("a_(e)"),i:s("n"),z:s("@"),q:s("@(e)"),S:s("c"),bc:s("fv<bH>?"),aQ:s("A?"),O:s("j<@>?"),a5:s("ax<@,@>?"),V:s("r?"),w:s("cW?"),u:s("e?"),A:s("e(ae)?"),I:s("bX?"),cG:s("a_?"),dd:s("n?"),a3:s("c?"),n:s("aq?"),H:s("aq"),bm:s("~(e,@)")}})();(function constants(){var s=hunkHelpers.makeConstList
B.P=J.ct.prototype
B.b=J.v.prototype
B.c=J.bu.prototype
B.a=J.aH.prototype
B.Q=J.ad.prototype
B.R=J.bx.prototype
B.u=A.aK.prototype
B.v=J.cR.prototype
B.k=J.b3.prototype
B.w=new A.cg(127)
B.i=new A.b_(A.l9(),A.bf("b_<c>"))
B.x=new A.cf()
B.ab=new A.ck()
B.y=new A.cj()
B.p=new A.bp(A.bf("bp<0&>"))
B.q=function getTagFallback(o) {
  var s = Object.prototype.toString.call(o);
  return s.substring(8, s.length - 1);
}
B.z=function() {
  var toStringFunction = Object.prototype.toString;
  function getTag(o) {
    var s = toStringFunction.call(o);
    return s.substring(8, s.length - 1);
  }
  function getUnknownTag(object, tag) {
    if (/^HTML[A-Z].*Element$/.test(tag)) {
      var name = toStringFunction.call(object);
      if (name == "[object Object]") return null;
      return "HTMLElement";
    }
  }
  function getUnknownTagGenericBrowser(object, tag) {
    if (object instanceof HTMLElement) return "HTMLElement";
    return getUnknownTag(object, tag);
  }
  function prototypeForTag(tag) {
    if (typeof window == "undefined") return null;
    if (typeof window[tag] == "undefined") return null;
    var constructor = window[tag];
    if (typeof constructor != "function") return null;
    return constructor.prototype;
  }
  function discriminator(tag) { return null; }
  var isBrowser = typeof HTMLElement == "function";
  return {
    getTag: getTag,
    getUnknownTag: isBrowser ? getUnknownTagGenericBrowser : getUnknownTag,
    prototypeForTag: prototypeForTag,
    discriminator: discriminator };
}
B.E=function(getTagFallback) {
  return function(hooks) {
    if (typeof navigator != "object") return hooks;
    var userAgent = navigator.userAgent;
    if (typeof userAgent != "string") return hooks;
    if (userAgent.indexOf("DumpRenderTree") >= 0) return hooks;
    if (userAgent.indexOf("Chrome") >= 0) {
      function confirm(p) {
        return typeof window == "object" && window[p] && window[p].name == p;
      }
      if (confirm("Window") && confirm("HTMLElement")) return hooks;
    }
    hooks.getTag = getTagFallback;
  };
}
B.A=function(hooks) {
  if (typeof dartExperimentalFixupGetTag != "function") return hooks;
  hooks.getTag = dartExperimentalFixupGetTag(hooks.getTag);
}
B.D=function(hooks) {
  if (typeof navigator != "object") return hooks;
  var userAgent = navigator.userAgent;
  if (typeof userAgent != "string") return hooks;
  if (userAgent.indexOf("Firefox") == -1) return hooks;
  var getTag = hooks.getTag;
  var quickMap = {
    "BeforeUnloadEvent": "Event",
    "DataTransfer": "Clipboard",
    "GeoGeolocation": "Geolocation",
    "Location": "!Location",
    "WorkerMessageEvent": "MessageEvent",
    "XMLDocument": "!Document"};
  function getTagFirefox(o) {
    var tag = getTag(o);
    return quickMap[tag] || tag;
  }
  hooks.getTag = getTagFirefox;
}
B.C=function(hooks) {
  if (typeof navigator != "object") return hooks;
  var userAgent = navigator.userAgent;
  if (typeof userAgent != "string") return hooks;
  if (userAgent.indexOf("Trident/") == -1) return hooks;
  var getTag = hooks.getTag;
  var quickMap = {
    "BeforeUnloadEvent": "Event",
    "DataTransfer": "Clipboard",
    "HTMLDDElement": "HTMLElement",
    "HTMLDTElement": "HTMLElement",
    "HTMLPhraseElement": "HTMLElement",
    "Position": "Geoposition"
  };
  function getTagIE(o) {
    var tag = getTag(o);
    var newTag = quickMap[tag];
    if (newTag) return newTag;
    if (tag == "Object") {
      if (window.DataView && (o instanceof window.DataView)) return "DataView";
    }
    return tag;
  }
  function prototypeForTagIE(tag) {
    var constructor = window[tag];
    if (constructor == null) return null;
    return constructor.prototype;
  }
  hooks.getTag = getTagIE;
  hooks.prototypeForTag = prototypeForTagIE;
}
B.B=function(hooks) {
  var getTag = hooks.getTag;
  var prototypeForTag = hooks.prototypeForTag;
  function getTagFixed(o) {
    var tag = getTag(o);
    if (tag == "Document") {
      if (!!o.xmlVersion) return "!Document";
      return "!HTMLDocument";
    }
    return tag;
  }
  function prototypeForTagFixed(tag) {
    if (tag == "Document") return null;
    return prototypeForTag(tag);
  }
  hooks.getTag = getTagFixed;
  hooks.prototypeForTag = prototypeForTagFixed;
}
B.r=function(hooks) { return hooks; }

B.F=new A.cz()
B.G=new A.cQ()
B.j=new A.dS()
B.f=new A.d9()
B.H=new A.db()
B.I=new A.D("section can't use both url and map entries",null,null)
B.J=new A.D('map containing "sections" cannot contain "mappings", "sources", or "names".',null,null)
B.K=new A.D("section missing offset",null,null)
B.L=new A.D("offset missing column",null,null)
B.M=new A.D("offset missing line",null,null)
B.N=new A.D("section missing url or map",null,null)
B.O=new A.D("expected at least one section",null,null)
B.S=new A.cA(null)
B.t=s([],t.s)
B.T=s([],A.bf("v<e?>"))
B.U=A.ab("lp")
B.V=A.ab("lq")
B.W=A.ab("iQ")
B.X=A.ab("iR")
B.Y=A.ab("j_")
B.Z=A.ab("j0")
B.a_=A.ab("j1")
B.a0=A.ab("r")
B.a1=A.ab("js")
B.a2=A.ab("eT")
B.a3=A.ab("jt")
B.a4=A.ab("eU")
B.a5=new A.da(!1)
B.a6=new A.b6("reaches root")
B.l=new A.b6("below root")
B.m=new A.b6("at root")
B.n=new A.b6("above root")
B.d=new A.b7("different")
B.o=new A.b7("equal")
B.e=new A.b7("inconclusive")
B.h=new A.b7("within")
B.a7=new A.b8(!1,!1,!1)
B.a8=new A.b8(!1,!1,!0)
B.a9=new A.b8(!1,!0,!1)
B.aa=new A.b8(!0,!1,!1)})();(function staticFields(){$.ea=null
$.Z=A.f([],A.bf("v<r>"))
$.fG=null
$.fr=null
$.fq=null
$.hG=null
$.hC=null
$.hN=null
$.eu=null
$.eA=null
$.fb=null
$.fW=""
$.fX=null
$.hp=null
$.ep=null
$.hw=null})();(function lazyInitializers(){var s=hunkHelpers.lazyFinal
s($,"ls","hR",()=>A.ev("_$dart_dartClosure"))
s($,"lr","fh",()=>A.ev("_$dart_dartClosure_dartJSInterop"))
s($,"m1","il",()=>A.f([new J.cu()],A.bf("v<bL>")))
s($,"lB","hV",()=>A.an(A.e6({
toString:function(){return"$receiver$"}})))
s($,"lC","hW",()=>A.an(A.e6({$method$:null,
toString:function(){return"$receiver$"}})))
s($,"lD","hX",()=>A.an(A.e6(null)))
s($,"lE","hY",()=>A.an(function(){var $argumentsExpr$="$arguments$"
try{null.$method$($argumentsExpr$)}catch(r){return r.message}}()))
s($,"lH","i0",()=>A.an(A.e6(void 0)))
s($,"lI","i1",()=>A.an(function(){var $argumentsExpr$="$arguments$"
try{(void 0).$method$($argumentsExpr$)}catch(r){return r.message}}()))
s($,"lG","i_",()=>A.an(A.fS(null)))
s($,"lF","hZ",()=>A.an(function(){try{null.$method$}catch(r){return r.message}}()))
s($,"lK","i3",()=>A.an(A.fS(void 0)))
s($,"lJ","i2",()=>A.an(function(){try{(void 0).$method$}catch(r){return r.message}}()))
s($,"lP","i8",()=>A.j9(4096))
s($,"lN","i6",()=>new A.ek().$0())
s($,"lO","i7",()=>new A.ej().$0())
s($,"lL","i4",()=>new Int8Array(A.kh(A.f([-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-1,-2,-2,-2,-2,-2,62,-2,62,-2,63,52,53,54,55,56,57,58,59,60,61,-2,-2,-2,-1,-2,-2,-2,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,-2,-2,-2,-2,63,-2,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,-2,-2,-2,-2,-2],t.t))))
s($,"lM","i5",()=>A.o("^[\\-\\.0-9A-Z_a-z~]*$",!1))
s($,"lZ","fj",()=>A.hJ(B.a0))
s($,"mg","ix",()=>A.eH($.cd()))
s($,"me","fk",()=>A.eH($.ar()))
s($,"m9","eF",()=>new A.co($.fi(),null))
s($,"ly","hU",()=>new A.cS(A.o("/",!1),A.o("[^/]$",!1),A.o("^/",!1)))
s($,"lA","cd",()=>new A.dc(A.o("[/\\\\]",!1),A.o("[^/\\\\]$",!1),A.o("^(\\\\\\\\[^\\\\]+\\\\[^\\\\/]+|[a-zA-Z]:[/\\\\])",!1),A.o("^[/\\\\](?![/\\\\])",!1)))
s($,"lz","ar",()=>new A.d8(A.o("/",!1),A.o("(^[a-zA-Z][-+.a-zA-Z\\d]*://|[^/])$",!1),A.o("[a-zA-Z][-+.a-zA-Z\\d]*://[^/]*",!1),A.o("^/",!1)))
s($,"lx","fi",()=>A.jk())
s($,"lR","ia",()=>new A.eq().$0())
s($,"mb","iu",()=>A.bb(A.hM(2,31))-1)
s($,"mc","iv",()=>-A.bb(A.hM(2,31)))
s($,"m8","it",()=>A.o("^#\\d+\\s+(\\S.*) \\((.+?)((?::\\d+){0,2})\\)$",!1))
s($,"m3","io",()=>A.o("^\\s*at (?:(\\S.*?)(?: \\[as [^\\]]+\\])? \\((.*)\\)|(.*))$",!1))
s($,"m4","ip",()=>A.o("^(.*?):(\\d+)(?::(\\d+))?$|native$",!1))
s($,"m7","is",()=>A.o("^\\s*at (?:(?<member>.+) )?(?:\\(?(?:(?<uri>\\S+):wasm-function\\[(?<index>\\d+)\\]\\:0x(?<offset>[0-9a-fA-F]+))\\)?)$",!1))
s($,"m2","im",()=>A.o("^eval at (?:\\S.*?) \\((.*)\\)(?:, .*?:\\d+:\\d+)?$",!1))
s($,"lS","ib",()=>A.o("(\\S+)@(\\S+) line (\\d+) >.* (Function|eval):\\d+:\\d+",!1))
s($,"lU","id",()=>A.o("^(?:([^@(/]*)(?:\\(.*\\))?((?:/[^/]*)*)(?:\\(.*\\))?@)?(.*?):(\\d*)(?::(\\d*))?$",!1))
s($,"lW","ig",()=>A.o("^(?<member>.*?)@(?:(?<uri>\\S+).*?:wasm-function\\[(?<index>\\d+)\\]:0x(?<offset>[0-9a-fA-F]+))$",!1))
s($,"m0","ik",()=>A.o("^.*?wasm-function\\[(?<member>.*)\\]@\\[wasm code\\]$",!1))
s($,"lX","ih",()=>A.o("^(\\S+)(?: (\\d+)(?::(\\d+))?)?\\s+([^\\d].*)$",!1))
s($,"lQ","i9",()=>A.o("<(<anonymous closure>|[^>]+)_async_body>",!1))
s($,"m_","ij",()=>A.o("^\\.",!1))
s($,"lt","hS",()=>A.o("^[a-zA-Z][-+.a-zA-Z\\d]*://",!1))
s($,"lu","hT",()=>A.o("^([a-zA-Z]:[\\\\/]|\\\\\\\\)",!1))
s($,"m5","iq",()=>A.o("(?:^|\\n)    ?at ",!1))
s($,"m6","ir",()=>A.o("    ?at ",!1))
s($,"lT","ic",()=>A.o("@\\S+ line \\d+ >.* (Function|eval):\\d+:\\d+",!1))
s($,"lV","ie",()=>A.o("^(([.0-9A-Za-z_$/<]|\\(.*\\))*@)?[^\\s]*:\\d*$",!0))
s($,"lY","ii",()=>A.o("^[^\\s<][^\\s]*( \\d+(:\\d+)?)?[ \\t]+[^\\s]+$",!0))
s($,"mf","fl",()=>A.o("^<asynchronous suspension>\\n?$",!0))
s($,"md","iw",()=>A.j3(A.bf("v<r?>").a(A.km(A.lf(),"$dartLoader").rootDirectories)))})();(function nativeSupport(){!function(){var s=function(a){var m={}
m[a]=1
return Object.keys(hunkHelpers.convertToFastObject(m))[0]}
v.getIsolateTag=function(a){return s("___dart_"+a+v.isolateTag)}
var r="___dart_isolate_tags_"
var q=Object[r]||(Object[r]=Object.create(null))
var p="_ZxYxX"
for(var o=0;;o++){var n=s(p+"_"+o+"_")
if(!(n in q)){q[n]=1
v.isolateTag=n
break}}v.dispatchPropertyName=v.getIsolateTag("dispatch_record")}()
hunkHelpers.setOrUpdateInterceptorsByTag({ArrayBuffer:A.b2,SharedArrayBuffer:A.b2,ArrayBufferView:A.bD,DataView:A.cH,Float32Array:A.cI,Float64Array:A.cJ,Int16Array:A.cK,Int32Array:A.cL,Int8Array:A.cM,Uint16Array:A.cN,Uint32Array:A.cO,Uint8ClampedArray:A.bE,CanvasPixelArray:A.bE,Uint8Array:A.aK})
hunkHelpers.setOrUpdateLeafTags({ArrayBuffer:true,SharedArrayBuffer:true,ArrayBufferView:false,DataView:true,Float32Array:true,Float64Array:true,Int16Array:true,Int32Array:true,Int8Array:true,Uint16Array:true,Uint32Array:true,Uint8ClampedArray:true,CanvasPixelArray:true,Uint8Array:false})
A.J.$nativeSuperclassTag="ArrayBufferView"
A.c0.$nativeSuperclassTag="ArrayBufferView"
A.c1.$nativeSuperclassTag="ArrayBufferView"
A.bC.$nativeSuperclassTag="ArrayBufferView"
A.c2.$nativeSuperclassTag="ArrayBufferView"
A.c3.$nativeSuperclassTag="ArrayBufferView"
A.W.$nativeSuperclassTag="ArrayBufferView"})()
Function.prototype.$0=function(){return this()}
Function.prototype.$1=function(a){return this(a)}
Function.prototype.$2=function(a,b){return this(a,b)}
Function.prototype.$3=function(a,b,c){return this(a,b,c)}
Function.prototype.$2$0=function(){return this()}
Function.prototype.$1$0=function(){return this()}
convertAllToFastObject(w)
convertToFastObject($);(function(a){if(typeof document==="undefined"){a(null)
return}if(typeof document.currentScript!="undefined"){a(document.currentScript)
return}var s=document.scripts
function onLoad(b){for(var q=0;q<s.length;++q){s[q].removeEventListener("load",onLoad,false)}a(b.target)}for(var r=0;r<s.length;++r){s[r].addEventListener("load",onLoad,false)}})(function(a){v.currentScript=a
var s=A.l5
if(typeof dartMainRunner==="function"){dartMainRunner(s,[])}else{s([])}})})()
