import{C as e,c as t,d as n,f as r,g as i,h as a,i as o,l as s,n as c,o as l,p as u,r as d,s as f,x as p,y as m}from"./chunks/CRRJpBh0.js";function h(e){let t=e;return{name:typeof t?.name==`string`?t.name:`Error`,message:typeof t?.message==`string`?t.message:String(e),...typeof t?.code==`string`?{code:t.code}:{}}}var g=class extends Error{code;name=`ContainerError`;constructor(e,t,n){super(t,n),this.code=e}},_=class extends Error{code;name=`FsError`;errno;constructor(e,t){super(t),this.code=e,this.errno=e}};function v(e,t,n,r){let i,a=[],o=!1,s=!1,c=!1,l=()=>{o||(o=!0,a.length=0,n?.removeEventListener(`abort`,u),r())},u=()=>{l(),i.close()};return{stream:new ReadableStream({start(e){i=e,n?.addEventListener(`abort`,u,{once:!0}),n?.aborted&&u()},pull(e){let t=a.shift();t?(a.length||(c=!1),e.enqueue(t)):s=!0},cancel:l},{highWaterMark:0}),get closed(){return o},push(n){if(!o){if(s){s=!1,i.enqueue(n);return}c||a.length>=t?(a.length=0,c=!0,a.push(Object.freeze({kind:`rescan`,path:e,generation:n.generation}))):a.push(n)}}}}const y=new TextEncoder,b=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;function x(e){if(typeof e!=`string`||!e||e.includes(`\0`)||b.test(e))throw new _(`EINVAL`,`Paths must be nonempty UTF-8 strings without NUL`);if(y.encode(e).byteLength>4096)throw new _(`EINVAL`,`Path exceeds 4096 UTF-8 bytes`);if(e.split(`/`).filter(Boolean).length>128)throw new _(`EINVAL`,`Path exceeds 128 components`)}function S(e){return e.split(`/`).filter(Boolean)}function C(e){return`/${e.join(`/`)}`}function w(e,t){return`${e===`/`?``:e}/${t}`}function T(e,t){return t===`/`||e===t||e.startsWith(`${t}/`)}function E(e,t){if(!Number.isSafeInteger(e)||e<0)throw new _(`EINVAL`,`${t} must be a nonnegative safe integer`)}function D(e){if(E(e,`mode`),e>511)throw new _(`EINVAL`,`Only permission mode bits are supported`)}function O(e,t){return e.length===t.length&&e.every((e,n)=>e===t[n])}function k(e,t,n){return e.inode===t.inode&&e.type===t.type&&e.mode===t.mode&&e.target===t.target&&e.command===t.command&&(!n||e.atimeMs===t.atimeMs&&e.mtimeMs===t.mtimeMs&&e.ctimeMs===t.ctimeMs)&&(e.type!==`file`||O(e.data,t.data))}var A=class e{root;mounts=/* @__PURE__ */ new Map;nodes=/* @__PURE__ */ new Set;descriptors=/* @__PURE__ */ new Map;nextInode=1;nextFd=3;usedBytes=0;revision=0;mutationSource;mutationObservers=/* @__PURE__ */ new Set;generationListeners=/* @__PURE__ */ new Set;versionSequence=0n;versions=/* @__PURE__ */ new WeakMap;lease;liveUsers=0;watchers=/* @__PURE__ */ new Set;maxBytes;maxInodes;constructor(e={}){this.maxBytes=e.maxBytes??67108864,this.maxInodes=e.maxInodes??16384,E(this.maxBytes,`maxBytes`),E(this.maxInodes,`maxInodes`),this.mounts.set(`/`,!0),this.root=this.allocate(`directory`,`/`,493);for(let e of[`/workspace`,`/tmp`,`/home`,`/home/user`,`/usr`,`/usr/bin`,`/usr/share`,`/opt`,`/dev`]){let t=S(e),n=t.pop(),r=this.walk(C(t),`/`,!0).node,i=e===`/workspace`||e===`/tmp`||e===`/home/user`;i&&this.mounts.set(e,!1),this.attach(r,n,this.allocate(`directory`,i?e:r.mount,493))}this.attach(this.walk(`/dev`,`/`,!0).node,`null`,this.allocate(`character-device`,`/`,438))}get generation(){return this.revision}withMutationSource(e,t){let n=this.mutationSource;this.mutationSource=e;try{return t()}finally{this.mutationSource=n}}observeMutations(){if(this.mutationObservers.size>=64)throw new _(`ENOSPC`,`Filesystem mutation observer limit reached`);let e={generation:this.revision,sources:/* @__PURE__ */ new Set,overflow:!1};this.mutationObservers.add(e);let t=!1;return{hasChangesOutside:n=>t||e.overflow||e.generation!==this.revision||[...e.sources].some(e=>!n.has(e)),dispose:()=>{t=!0,e.sources.clear(),this.mutationObservers.delete(e)}}}onGenerationChange(e){if(typeof e!=`function`)throw new _(`EINVAL`,`Generation listener must be a function`);if(this.generationListeners.size>=256)throw new _(`ENOSPC`,`Filesystem generation listener limit reached`);let t=t=>e(t);return this.generationListeners.add(t),()=>{this.generationListeners.delete(t)}}advanceGeneration(){this.revision++;for(let e of this.generationListeners)try{e(this.revision)}catch{}for(let e of this.mutationObservers)e.generation=this.revision,e.sources.size<64||e.sources.has(this.mutationSource)?e.sources.add(this.mutationSource):e.overflow=!0}get byteLength(){return this.usedBytes}get inodeCount(){return this.nodes.size}get watcherCount(){return this.watchers.size}watch(e={}){let t=e.maxQueuedEvents??32;if(!Number.isSafeInteger(t)||t<1||t>256)throw new _(`EINVAL`,`Watch queue must contain 1..256 events`);if(this.watchers.size>=64)throw new _(`ENOSPC`,`Filesystem watcher limit reached`);let n=this.resolve(e.path??`/workspace`);if(n.node.type!==`directory`)throw new _(`ENOTDIR`,`Watch scope must be a directory`);let r={root:n.path,push:e=>{}},i=v(r.root,t,e.signal,()=>{this.watchers.delete(r)});return r.push=i.push,i.closed||this.watchers.add(r),i.stream}notify(e){if(!this.watchers.size)return;let t=Object.freeze({...e,generation:this.revision});for(let e of this.watchers)t.kind===`rescan`||T(e.root,t.path)&&e.root!==t.path||t.previousPath&&T(e.root,t.previousPath)?e.push(Object.freeze({kind:`rescan`,path:e.root,generation:this.revision})):(T(t.path,e.root)||t.previousPath&&T(t.previousPath,e.root))&&e.push(t)}nodePath(e){if(e===this.root)return`/`;let t=[],n=e;for(;n!==this.root;){if(!n.linked||!n.parent)return;t.push(n.name),n=n.parent}return C(t.reverse())}attach(e,t,n){e.children.set(t,n),n.parent=e,n.name=t}notifyFile(e){if(!this.watchers.size||!e.linked)return;let t=this.nodePath(e);this.notify(t===void 0?{kind:`rescan`,path:`/`}:{kind:`modify`,path:t,inode:e.inode})}allocate(e,t,n){if(this.nodes.size>=this.maxInodes)throw new _(`ENOSPC`,`Filesystem inode quota exceeded`);if(this.nextInode>=2**53-1)throw new _(`ENOSPC`,`Filesystem inode identities exhausted`);D(n);let r=Date.now(),i=e===`character-device`?0:this.nextInode++,a={inode:i,type:e,mode:n,mount:t,data:/* @__PURE__ */ new Uint8Array,target:``,children:/* @__PURE__ */ new Map,name:``,references:0,linked:!0,atimeMs:r,mtimeMs:r,ctimeMs:r,version:Object.freeze({inode:i,revision:++this.versionSequence})};return this.versions.set(a.version,a),this.nodes.add(a),a}release(e){!e.linked&&e.references===0&&(this.nodes.delete(e),this.usedBytes-=e.data.length+y.encode(e.target).length)}writable(e){if(this.lease)throw new _(`EBUSY`,`A snapshot process holds the filesystem writer lease`);if(this.mounts.get(e.mount)!==!1)throw new _(`EROFS`,`The resolved mount is readonly`)}changed(...e){this.advanceGeneration();let t=Date.now();for(let n of e)n.mtimeMs=n.ctimeMs=t,this.invalidateVersion(n)}invalidateVersion(e,t=!1){if(e.version=Object.freeze({inode:e.inode,revision:++this.versionSequence}),this.versions.set(e.version,e),t)for(let t of e.children.values())this.invalidateVersion(t,!0)}captureFileVersion(e,t={}){let n=typeof e==`number`?this.descriptor(e).node:this.resolve(e,t).node;return this.file(n),n.version}readFileVersion(e){let t=this.versions.get(e);if(!t||!this.nodes.has(t)||!t.linked||t.version!==e||t.command)return;let n=this.nodePath(t);if(n!==void 0)return{path:n,mode:t.mode,bytes:t.data.slice()}}grantExecutable(e){let t=this.versions.get(e);if(!t||!this.nodes.has(t)||!t.linked||t.version!==e||t.command)return!1;this.writable(t);let n=t.mode|(t.mode&292)>>2;return n!==t.mode&&(t.mode=n,this.changed(t),this.notifyFile(t)),!0}walk(e,t,n,r=t){x(e);let i=S(t),a=S(e.startsWith(`/`)?e:`${r}/${e}`);for(let e=0;e<i.length;e++)if(a[e]!==i[e])throw new _(`EACCES`,`Path is outside the directory capability`);let o=[this.root],s=[],c=0;for(;a.length>0;){let t=a.shift(),r=o[o.length-1];if(r.type!==`directory`)throw new _(`ENOTDIR`,`Path component is not a directory`);if(t===`.`)continue;if(t===`..`){if(s.length<=i.length){if(i.length!==0)throw new _(`EACCES`,`Path escapes the directory capability`)}else s.pop(),o.pop();continue}let l=r.children.get(t);if(!l)throw new _(`ENOENT`,`Path does not exist`);if(l.type===`symlink`&&(n||a.length>0||e.endsWith(`/`))){if(++c>40)throw new _(`ELOOP`,`Too many symbolic links`);let e=S(l.target);if(l.target.endsWith(`/`)&&e.push(`.`),l.target.startsWith(`/`)){if(i.some((t,n)=>e[n]!==t))throw new _(`EACCES`,`Symlink escapes the directory capability`);s.length=0,o.length=1}a.unshift(...e)}else s.push(t),o.push(l)}let l=o[o.length-1];if(e.endsWith(`/`)&&l.type!==`directory`)throw new _(`ENOTDIR`,`Trailing slash requires a directory`);let u=C(s);if(x(u),!T(u,t))throw new _(`EACCES`,`Path escapes the directory capability`);return{node:l,path:u}}context(e){let t=e.root??`/`;if(x(t),!t.startsWith(`/`))throw new _(`EINVAL`,`Capability root must be absolute`);let n=this.walk(t,`/`,!0);if(n.node.type!==`directory`)throw new _(`ENOTDIR`,`Capability root must be a directory`);let r=e.cwd??(n.path===`/`?`/workspace`:n.path);if(x(r),!r.startsWith(`/`))throw new _(`EINVAL`,`Working directory must be absolute`);let i=this.walk(r,n.path,!0);if(i.node.type!==`directory`)throw new _(`ENOTDIR`,`Working directory must be a directory`);return{root:n.path,cwd:i.path}}resolve(e,t={},n=!0){let{root:r,cwd:i}=this.context(t);return this.walk(e,r,n,i)}parent(e,t){x(e);let n=e.split(`/`);for(;n.at(-1)===``;)n.pop();let r=n.pop();if(!r||r===`.`||r===`..`)throw new _(`EINVAL`,`Operation requires an ordinary final path component`);let i=this.resolve(n.join(`/`)||(e.startsWith(`/`)?`/`:`.`),t);if(i.node.type!==`directory`)throw new _(`ENOTDIR`,`Parent is not a directory`);return x(`${i.path===`/`?``:i.path}/${r}`),{...i,name:r}}createParent(e,t){let n=e,r=t,i=!1;for(let e=0;e<=40;e++){i||=n.endsWith(`/`);let e=this.parent(n,r),a=e.node.children.get(e.name);if(a?.type!==`symlink`){if(!a&&i)throw new _(`ENOTDIR`,`File destination has a trailing slash`);return e}n=a.target,r={...t,cwd:e.path}}throw new _(`ELOOP`,`Too many symbolic links`)}file(e){if(e.type===`directory`)throw new _(`EISDIR`,`Operation requires a regular file`);if(e.type!==`file`)throw new _(`EINVAL`,`Operation requires a regular file`)}info(e){return{inode:e.inode,type:e.type,mode:e.mode,size:e.type===`file`?e.data.length:e.type===`symlink`?y.encode(e.target).length:0,atimeMs:e.atimeMs,mtimeMs:e.mtimeMs,ctimeMs:e.ctimeMs,...e.command?{command:!0}:{}}}checkPlacement(e,t){let n=0,r=0,i=(e,t,a)=>{for(let[o,s]of e.children){let e=t+1,c=a+1+y.encode(o).byteLength;n=Math.max(n,e),r=Math.max(r,c),i(s,e,c)}};if(t&&i(t,0,0),y.encode(e).byteLength+r>4096||S(e).length+n>128)throw new _(`EINVAL`,`Resulting path exceeds 4096 UTF-8 bytes or 128 components`)}stat(e,t={}){return this.info(this.resolve(e,t).node)}lstat(e,t={}){return this.info(this.resolve(e,t,!1).node)}realpath(e,t={}){return this.resolve(e,t).path}setTimes(e,t,n={},r=!0){this.updateTimes(this.resolve(e,n,r).node,t)}fsetTimes(e,t){this.updateTimes(this.descriptor(e).node,t)}updateTimes(e,t){if(!t||typeof t!=`object`||Array.isArray(t))throw new _(`EINVAL`,`Invalid timestamp update`);let n=Object.create(null);for(let[e,r]of Object.entries(t)){if(e!==`atimeMs`&&e!==`mtimeMs`)throw new _(`EINVAL`,`Unsupported timestamp field`);r!==void 0&&r!==`now`&&E(r,e),n[e]=r}if(n.atimeMs===void 0&&n.mtimeMs===void 0)return;this.writable(e);let r=Date.now();n.atimeMs!==void 0&&(e.atimeMs=n.atimeMs===`now`?r:n.atimeMs),n.mtimeMs!==void 0&&(e.mtimeMs=n.mtimeMs===`now`?r:n.mtimeMs),e.ctimeMs=r,this.advanceGeneration(),this.invalidateVersion(e),this.notifyFile(e)}readdir(e,t={}){let{node:n}=this.resolve(e,t);if(n.type!==`directory`)throw new _(`ENOTDIR`,`Path is not a directory`);return[...n.children.keys()].sort()}readlink(e,t={}){let{node:n}=this.resolve(e,t,!1);if(n.type!==`symlink`)throw new _(`EINVAL`,`Path is not a symbolic link`);return n.target}readFile(e,t={}){let{node:n}=this.resolve(e,t);if(n.command)throw new _(`ENOTSUP`,`Virtual command entries have no readable executable body`);return n.type===`character-device`?/* @__PURE__ */ new Uint8Array:(this.file(n),n.data.slice())}isReadonly(e,t={}){return this.mounts.get(this.resolve(e,t).node.mount)!==!1}writeFile(e,t,n={}){if(!(t instanceof Uint8Array))throw new _(`EINVAL`,`File content must be Uint8Array`);n.mode!==void 0&&D(n.mode);let r;try{r=this.resolve(e,n).node}catch(i){if(!(i instanceof _)||i.code!==`ENOENT`)throw i;let a=this.createParent(e,n);if(this.writable(a.node),a.node.children.has(a.name))throw i;if(e.endsWith(`/`))throw new _(`ENOTDIR`,`File path ends with a slash`);if(this.checkPlacement(w(a.path,a.name)),this.usedBytes+t.length>this.maxBytes)throw new _(`ENOSPC`,`Filesystem byte quota exceeded`);let o=Uint8Array.from(t);r=this.allocate(`file`,a.node.mount,n.mode??420),r.data=o,this.usedBytes+=o.length,this.attach(a.node,a.name,r),this.changed(a.node,r),this.notify({kind:`create`,path:`${a.path===`/`?``:a.path}/${a.name}`,inode:r.inode});return}if(r.type===`character-device`)return;if(this.writable(r),this.file(r),this.usedBytes-r.data.length+t.length>this.maxBytes)throw new _(`ENOSPC`,`Filesystem byte quota exceeded`);let i=Uint8Array.from(t);this.usedBytes+=i.length-r.data.length,r.data=i,this.changed(r),this.notifyFile(r)}applyFileChanges(t,n={}){if(!t||!Array.isArray(t.write)||!Array.isArray(t.remove))throw new _(`EINVAL`,`Invalid file changes`);for(let e of t.write){if(!e||!(e.bytes instanceof Uint8Array))throw new _(`EINVAL`,`File content must be Uint8Array`);x(e.path)}for(let e of t.remove)x(e);if(n.createRoot!==void 0&&typeof n.createRoot!=`boolean`)throw new _(`EINVAL`,`Invalid root creation option`);if(n.createRoot){if(typeof n.root!=`string`||!n.root.startsWith(`/`))throw new _(`EINVAL`,`Root creation requires an explicit absolute capability root`);x(n.root)}if(!t.write.length&&!t.remove.length&&!n.createRoot)return;let r=new e({maxBytes:this.maxBytes,maxInodes:this.maxInodes}),i=new Map([...this.nodes].map(e=>[e,{...e,children:/* @__PURE__ */ new Map}]));for(let[e,t]of i){t.parent=e.parent&&i.get(e.parent);for(let[n,r]of e.children)t.children.set(n,i.get(r))}r.root=i.get(this.root),r.nodes=new Set(i.values()),r.mounts=this.mounts,r.usedBytes=this.usedBytes,r.nextInode=this.nextInode,r.revision=this.revision,r.versionSequence=this.versionSequence,r.lease=this.lease,n.createRoot&&r.mkdir(n.root,{root:`/`,cwd:`/`,recursive:!0});for(let e of t.remove)try{r.unlink(e,n)}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e}for(let{path:e,bytes:i}of t.write){let t=e.split(`/`).slice(0,-1).join(`/`);t&&r.mkdir(t,{...n,recursive:!0});try{let t=r.resolve(e,n).node;if(t.type===`file`&&O(t.data,i))continue}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e}r.writeFile(e,i,n)}if(r.revision===this.revision)return;let a=new Map([...this.nodes].map(e=>[e.inode,e])),o=new Map([...r.nodes].map(e=>[e,a.get(e.inode)??e])),s=[...r.nodes].map(e=>({node:o.get(e),state:{...e,parent:e.parent&&o.get(e.parent),children:new Map([...e.children].map(([e,t])=>[e,o.get(t)]))}})),c=new Set(o.values());for(let{node:e,state:t}of s)this.versions.set(t.version,e);for(let e of this.nodes)c.has(e)||(e.parent=void 0,e.linked=!1);for(let{node:e,state:t}of s)Object.assign(e,t);this.nodes=c,this.usedBytes=r.usedBytes,this.nextInode=r.nextInode,this.versionSequence=r.versionSequence,this.advanceGeneration(),this.notify({kind:`rescan`,path:`/`})}mkdir(e,t={}){if(t.mode!==void 0&&D(t.mode),t.recursive){x(e);let n=S(e),r=e.startsWith(`/`)?``:`.`;for(let e of n){r+=`/${e}`;try{if(this.stat(r,t).type!==`directory`)throw new _(`ENOTDIR`,`Path component is not a directory`)}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e;this.mkdir(r,{...t,recursive:!1})}}return}let n=e.split(`/`).filter(Boolean).at(-1);if(n===void 0||n===`.`||n===`..`)throw x(e),this.resolve(e,t),new _(`EEXIST`,`Path already exists`);let r=this.parent(e,t);if(r.node.children.has(r.name))throw new _(`EEXIST`,`Path already exists`);this.writable(r.node),this.checkPlacement(w(r.path,r.name));let i=this.allocate(`directory`,r.node.mount,t.mode??493);this.attach(r.node,r.name,i),this.changed(r.node),this.notify({kind:`create`,path:`${r.path===`/`?``:r.path}/${r.name}`,inode:i.inode})}symlink(e,t,n={}){x(e);let r=this.parent(t,n);if(this.writable(r.node),r.node.children.has(r.name))throw new _(`EEXIST`,`Path already exists`);if(t.endsWith(`/`))throw new _(`ENOENT`,`Symlink destination has a trailing slash`);this.checkPlacement(w(r.path,r.name));let i=y.encode(e).length;if(this.usedBytes+i>this.maxBytes)throw new _(`ENOSPC`,`Filesystem byte quota exceeded`);let a=this.allocate(`symlink`,r.node.mount,511);a.target=e,this.usedBytes+=i,this.attach(r.node,r.name,a),this.changed(r.node),this.notify({kind:`create`,path:`${r.path===`/`?``:r.path}/${r.name}`,inode:a.inode})}unlink(e,t={}){let n=this.parent(e,t),r=n.node.children.get(n.name);if(!r)throw new _(`ENOENT`,`Path does not exist`);if(this.writable(n.node),r.type===`directory`)throw new _(`EISDIR`,`Use rmdir for directories`);if(e.endsWith(`/`))throw new _(`ENOTDIR`,`Trailing slash requires a directory`);n.node.children.delete(n.name),r.linked=!1,r.parent=void 0,this.invalidateVersion(r),this.release(r),this.changed(n.node),this.notify({kind:`remove`,path:`${n.path===`/`?``:n.path}/${n.name}`,inode:r.inode})}rmdir(e,t={}){let n=this.parent(e,t),r=n.node.children.get(n.name);if(!r)throw new _(`ENOENT`,`Path does not exist`);if(this.writable(n.node),r.type!==`directory`)throw new _(`ENOTDIR`,`Path is not a directory`);if(r.mount!==n.node.mount)throw new _(`EBUSY`,`Cannot remove a mount root`);if(r.children.size)throw new _(`ENOTEMPTY`,`Directory is not empty`);n.node.children.delete(n.name),r.linked=!1,r.parent=void 0,this.invalidateVersion(r),this.release(r),this.changed(n.node),this.notify({kind:`remove`,path:`${n.path===`/`?``:n.path}/${n.name}`,inode:r.inode})}rename(e,t,n={}){let r=this.parent(e,n),i=this.parent(t,n),a=r.node.children.get(r.name);if(!a)throw new _(`ENOENT`,`Source does not exist`);if(a.mount!==r.node.mount)throw new _(`EBUSY`,`Cannot rename a mount root`);if(r.node.mount!==i.node.mount)throw new _(`EXDEV`,`Cannot rename across mounts`);let o=[{node:a,path:`${i.path===`/`?``:i.path}/${i.name}`}];for(;o.length;){let e=o.pop();x(e.path);for(let[t,n]of e.node.children)o.push({node:n,path:`${e.path}/${t}`})}if(this.writable(r.node),this.writable(i.node),r.node===i.node&&r.name===i.name)return;let s=i.node.children.get(i.name);if((e.endsWith(`/`)||t.endsWith(`/`))&&a.type!==`directory`)throw new _(`ENOTDIR`,`Trailing slash requires a directory`);let c=w(r.path,r.name);if(a.type===`directory`&&T(i.path,c))throw new _(`EINVAL`,`Cannot move a directory inside itself`);if(this.checkPlacement(w(i.path,i.name),a),s){if(s.mount!==i.node.mount)throw new _(`EBUSY`,`Cannot replace a mount root`);if(s.type===`directory`&&a.type!==`directory`)throw new _(`EISDIR`,`Destination is a directory`);if(s.type!==`directory`&&a.type===`directory`)throw new _(`ENOTDIR`,`Destination is not a directory`);if(s.children.size)throw new _(`ENOTEMPTY`,`Destination directory is not empty`);s.linked=!1,s.parent=void 0,this.invalidateVersion(s,!0),this.release(s)}r.node.children.delete(r.name),this.attach(i.node,i.name,a),this.changed(r.node,i.node,a);for(let e of a.children.values())this.invalidateVersion(e,!0);this.notify({kind:`rename`,path:`${i.path===`/`?``:i.path}/${i.name}`,previousPath:c,inode:a.inode})}open(e,t={}){if(this.lease)throw new _(`EBUSY`,`Host descriptors cannot open during a snapshot writer lease`);if(t.snapshot!==void 0&&t.snapshot!==`preserve`)throw new _(`EINVAL`,`Invalid snapshot descriptor policy`);let n=t.read??!(t.write||t.resize),r=t.write??!1,i=t.resize??!1;if(!n&&!r&&!i)throw new _(`EINVAL`,`Open must request read, write or resize access`);if((t.truncate||t.append)&&!r)throw new _(`EINVAL`,`Truncate/append require write access`);let{root:a}=this.context(t);if(t.create&&t.exclusive)try{throw this.resolve(e,t,!1),new _(`EEXIST`,`Path already exists`)}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e}let o;try{if(o=this.resolve(e,t),t.create&&t.exclusive)throw new _(`EEXIST`,`Path already exists`)}catch(n){if(!(n instanceof _)||n.code!==`ENOENT`||!t.create||t.directory)throw n;this.writeFile(e,/* @__PURE__ */ new Uint8Array,t),o=this.resolve(e,t)}let{node:s}=o;if(s.command)throw new _(`ENOTSUP`,`Virtual commands execute through the registered backend`);if(t.directory&&s.type!==`directory`)throw new _(`ENOTDIR`,`A directory descriptor was requested`);r&&s.type!==`character-device`&&(this.writable(s),this.file(s)),i&&s.type===`file`&&this.writable(s),t.truncate&&s.type!==`character-device`&&this.resize(s,0);let c=this.nextFd++;return s.references++,this.descriptors.set(c,{node:s,offset:0,read:n,write:r,resize:i,append:t.append??!1,root:a,preserveSnapshot:t.snapshot===`preserve`}),c}descriptor(e){let t=this.descriptors.get(e);if(!t)throw new _(`EBADF`,`Invalid or closed file descriptor`);return t}fstat(e){return this.info(this.descriptor(e).node)}tell(e){return this.descriptor(e).offset}getDirectoryPath(e){let t=this.descriptor(e);if(t.node.type!==`directory`)throw new _(`ENOTDIR`,`Descriptor is not a directory`);let n=this.nodePath(t.node);if(n===void 0)throw new _(`ENOENT`,`Directory descriptor has been unlinked`);if(!T(n,t.root))throw new _(`EACCES`,`Directory moved outside its capability`);return n}dup(e){let t=this.descriptor(e),n=this.nextFd++;return t.node.references++,this.descriptors.set(n,t),n}close(e){let{node:t}=this.descriptor(e);this.descriptors.delete(e),t.references--,this.release(t)}read(e,t){let n=this.descriptor(e),r=this.pread(e,t,n.offset);return n.offset+=r.length,r}pread(e,t,n){E(t,`length`),E(n,`offset`);let r=this.descriptor(e);if(!r.read)throw new _(`EBADF`,`Descriptor is not readable`);return r.node.type===`character-device`?/* @__PURE__ */ new Uint8Array:(this.file(r.node),r.node.data.slice(n,Math.min(r.node.data.length,n+t)))}write(e,t){let n=this.descriptor(e),r=n.append?n.node.data.length:n.offset,i=this.pwrite(e,t,r);return i!==0&&n.node.type!==`character-device`&&(n.offset=r+i),i}pwrite(e,t,n){if(E(n,`offset`),!(t instanceof Uint8Array))throw new _(`EINVAL`,`File content must be Uint8Array`);let r=this.descriptor(e);if(!r.write)throw new _(`EBADF`,`Descriptor is not writable`);let{node:i}=r;return i.type===`character-device`?t.length:(this.writable(i),this.file(i),t.length===0?0:(E(n+t.length,`write end`),n+t.length>i.data.length&&this.resize(i,n+t.length,!1),i.data.set(t,n),this.changed(i),this.notifyFile(i),t.length))}seek(e,t,n=`set`){if(!Number.isSafeInteger(t))throw new _(`EINVAL`,`Offset must be a safe integer`);let r=this.descriptor(e);if(![`set`,`cur`,`end`].includes(n))throw new _(`EINVAL`,`Invalid seek origin`);if(r.node.type===`character-device`)return r.offset=0;this.file(r.node);let i=t+(n===`cur`?r.offset:n===`end`?r.node.data.length:0);return E(i,`resulting offset`),r.offset=i}resize(e,t,n=!0){E(t,`length`),this.file(e),this.writable(e);let r=e.data.length,i=this.maxBytes-this.usedBytes+r;if(t>i)throw new _(`ENOSPC`,`Filesystem byte quota exceeded`);let a=e.data;if(t<r)a=e.data.slice(0,t);else if(t>r){let n=e.data.buffer.byteLength-e.data.byteOffset;if(t>n){let r=new Uint8Array(Math.min(i,Math.max(t,n*2)));r.set(e.data),a=r.subarray(0,t)}else a=new Uint8Array(e.data.buffer,e.data.byteOffset,t),a.fill(0,r)}this.usedBytes+=t-r,e.data=a,n&&(this.changed(e),this.notifyFile(e))}truncate(e,t=0,n={}){this.resize(this.resolve(e,n).node,t)}ftruncate(e,t=0){let n=this.descriptor(e);if(!n.write&&!n.resize)throw new _(`EBADF`,`Descriptor cannot resize files`);this.resize(n.node,t)}exportSnapshot(e={}){let t=[],n=(r,i)=>{(!e.includePath||e.includePath(i))&&t.push({inode:r.inode,path:i,type:r.type,mode:r.mode,atimeMs:r.atimeMs,mtimeMs:r.mtimeMs,ctimeMs:r.ctimeMs,...r.command?{command:!0}:{},...r.type===`file`?{data:r.data.slice()}:{},...r.type===`symlink`?{target:r.target}:{}});for(let[e,t]of[...r.children].sort(([e],[t])=>e.localeCompare(t)))n(t,`${i===`/`?``:i}/${e}`)};return n(this.root,`/`),{generation:this.revision,nextInode:this.nextInode,mounts:[...this.mounts].map(([e,t])=>({path:e,readonly:t})),entries:t}}publish(e){let t=new Map([...this.nodes].map(e=>[e.inode,e])),n=new Map([...e.nodes].map(e=>[e.inode,e])),r=[...new Set(this.descriptors.values())];for(let{node:e}of r)if(e.linked&&!n.has(e.inode))throw new _(`ECONFLICT`,`Snapshot removed an inode with an open host descriptor`);let i=[...this.nodes].filter(e=>!e.linked&&e.references>0),a=i.reduce((e,t)=>e+t.data.length+y.encode(t.target).length,0);if(e.nodes.size+i.length>this.maxInodes||e.usedBytes+a>this.maxBytes)throw new _(`ENOSPC`,`Snapshot exceeds quota including retained open files`);let o=r.map(e=>({description:e,node:n.get(e.node.inode)??e.node}));for(let n of e.nodes)n.references=t.get(n.inode)?.references??0;let s=/* @__PURE__ */ new Set([...e.nodes,...i]);for(let t of e.nodes)this.invalidateVersion(t);for(let e of this.nodes)e.parent=void 0;for(let{description:e,node:t}of o)e.node=t;this.root=e.root,this.nodes=s,this.mounts=e.mounts,this.usedBytes=e.usedBytes+a,this.nextInode=e.nextInode,this.advanceGeneration(),this.notify({kind:`rescan`,path:`/`})}static fromSnapshot(t,n={}){if(!t||!Array.isArray(t.entries)||!Array.isArray(t.mounts))throw new _(`EINVAL`,`Malformed filesystem snapshot`);if(E(t.generation,`generation`),E(t.nextInode,`nextInode`),t.nextInode<1)throw new _(`EINVAL`,`Snapshot nextInode must be positive`);let r=new e(n);if(t.entries.length>r.maxInodes)throw new _(`ENOSPC`,`Snapshot exceeds inode quota`);let i=/* @__PURE__ */ new Map,a=/* @__PURE__ */ new Set,o=0;for(let e of t.entries){if(!e||typeof e!=`object`)throw new _(`EINVAL`,`Invalid snapshot entry`);if(E(e.inode,`inode`),e.inode===0&&e.type!==`character-device`||e.inode>=t.nextInode||a.has(e.inode))throw new _(`EINVAL`,`Snapshot inode identities must be unique and below nextInode`);if(a.add(e.inode),x(e.path),!e.path.startsWith(`/`)||C(S(e.path))!==e.path||S(e.path).some(e=>e===`.`||e===`..`))throw new _(`EINVAL`,`Snapshot paths must be canonical and absolute`);if(i.has(e.path))throw new _(`EINVAL`,`Duplicate snapshot path`);if(D(e.mode),e.atimeMs!==void 0&&E(e.atimeMs,`atimeMs`),e.mtimeMs!==void 0&&E(e.mtimeMs,`mtimeMs`),e.ctimeMs!==void 0&&E(e.ctimeMs,`ctimeMs`),![`file`,`directory`,`symlink`,`character-device`].includes(e.type))throw new _(`EINVAL`,`Invalid snapshot entry type`);if(e.type===`character-device`&&(e.path!==`/dev/null`||e.inode!==0||e.mode!==438))throw new _(`EINVAL`,`Only the immutable /dev/null character device is supported`);if(e.command!==void 0&&(e.command!==!0||e.type!==`file`||e.mode!==365||e.data?.length!==0))throw new _(`EINVAL`,`Invalid virtual command entry`);if(e.type===`file`){if(!(e.data instanceof Uint8Array)||e.target!==void 0)throw new _(`EINVAL`,`Invalid file entry`);o+=e.data.length}else if(e.type===`symlink`){if(x(e.target),e.data!==void 0)throw new _(`EINVAL`,`Invalid symlink entry`);o+=y.encode(e.target).length}else if(e.data!==void 0||e.target!==void 0)throw new _(`EINVAL`,`Invalid directory entry`);if(o>r.maxBytes)throw new _(`ENOSPC`,`Snapshot exceeds byte quota`);i.set(e.path,e)}if(i.get(`/`)?.type!==`directory`)throw new _(`EINVAL`,`Snapshot needs a root directory`);let s=/* @__PURE__ */ new Map;for(let e of t.mounts){if(!e||typeof e.path!=`string`||typeof e.readonly!=`boolean`||s.has(e.path)||i.get(e.path)?.type!==`directory`)throw new _(`EINVAL`,`Invalid or duplicate snapshot mount`);s.set(e.path,e.readonly)}if(s.get(`/`)!==!0)throw new _(`EINVAL`,`Root mount must be readonly`);for(let[e,t]of i){if(e===`/`)continue;let n=e.slice(0,e.lastIndexOf(`/`))||`/`;if(i.get(n)?.type!==`directory`)throw new _(`ENOTDIR`,`Snapshot parent is missing or not a directory`);if(t.type===`directory`&&S(e).length>128)throw new _(`EINVAL`,`Snapshot exceeds directory depth limit`)}r.nodes.clear(),r.nextInode=1,r.mounts=s;let c=/* @__PURE__ */ new Map,l=[...s.keys()].sort((e,t)=>t.length-e.length);for(let[e,t]of[...i].sort(([e],[t])=>S(e).length-S(t).length)){let n=l.find(t=>T(e,t));if((t.command||t.type===`character-device`)&&!s.get(n))throw new _(`EINVAL`,`Virtual commands and devices require a readonly mount`);let i=r.allocate(t.type,n,t.mode);if(i.command=t.command,i.inode=t.inode,r.invalidateVersion(i),t.mtimeMs!==void 0&&(i.mtimeMs=t.mtimeMs),t.ctimeMs!==void 0&&(i.ctimeMs=t.ctimeMs),i.atimeMs=t.atimeMs??i.mtimeMs,i.data=t.data?Uint8Array.from(t.data):/* @__PURE__ */ new Uint8Array,i.target=t.target??``,c.set(e,i),e===`/`)r.root=i;else{let t=e.lastIndexOf(`/`);r.attach(c.get(e.slice(0,t)||`/`),e.slice(t+1),i)}}return r.usedBytes=o,r.revision=t.generation,r.nextInode=t.nextInode,r}acquireLive(){if(this.lease)throw new _(`EBUSY`,`A snapshot process holds the filesystem writer lease`);this.liveUsers++;let e=!1;return{release:()=>{e||(e=!0,this.liveUsers--)}}}acquireSnapshot(){if(this.lease||this.liveUsers||[...this.descriptors.values()].some(e=>!e.preserveSnapshot))throw new _(`EBUSY`,`Snapshot requires no live process, active lease or unpreserved host descriptor`);let t=Symbol(`filesystem-lease`),n=this.revision,r=this.exportSnapshot();this.lease=t;let i=!1;return{snapshot:r,discard:()=>{i||(i=!0,this.lease===t&&(this.lease=void 0))},commit:r=>{if(i||this.lease!==t)throw new _(`ECONFLICT`,`Snapshot lease is no longer active`);if(this.revision!==n)throw new _(`ECONFLICT`,`Filesystem generation changed`);let a=e.fromSnapshot(r,{maxBytes:this.maxBytes,maxInodes:this.maxInodes});if(a.nextInode<this.nextInode)throw new _(`ECONFLICT`,`Snapshot cannot rewind inode allocation`);let o=new Map([...this.nodes].map(e=>[e.inode,e])),s=new Map(r.entries.map(e=>[e.inode,e]));for(let e of a.nodes){let t=o.get(e.inode);if((!t||!t.linked)&&e.inode<this.nextInode)throw new _(`ECONFLICT`,`Snapshot reused a retired inode identity`);if(t&&(t.type!==e.type||t.mount!==e.mount))throw new _(`ECONFLICT`,`Snapshot cannot change an inode type or mount identity`);t&&s.get(e.inode).atimeMs===void 0&&(e.atimeMs=t.atimeMs)}if(a.mounts.size!==this.mounts.size||[...this.mounts].some(([e,t])=>a.mounts.get(e)!==t))throw new _(`EROFS`,`Snapshot cannot change the mount table`);let c=new Map(this.exportSnapshot().entries.map(e=>[e.path,e])),l=new Map(a.exportSnapshot().entries.map(e=>[e.path,e])),u=[...this.mounts.keys()].sort((e,t)=>t.length-e.length);for(let e of/* @__PURE__ */ new Set([...c.keys(),...l.keys()])){let t=u.find(t=>T(e,t)),n=c.get(e),r=l.get(e);if((this.mounts.get(t)||this.mounts.has(e))&&(!n||!r||!k(n,r,this.mounts.get(t))))throw new _(`EROFS`,`Snapshot changed a readonly entry or mount root`)}this.publish(a),this.lease=void 0,i=!0}}}mountReadonly(e,t){this.mountReadonlyPackages([{path:e,entries:t}])}mountCommands(e,t){if(!Array.isArray(t)||t.length===0||new Set(t).size!==t.length||t.some(e=>typeof e!=`string`||!e||e.includes(`/`)||e===`.`||e===`..`))throw new _(`EINVAL`,`Virtual commands require distinct file names`);this.mountReadonly(e,t.map(e=>({path:e,type:`file`,mode:365,command:!0,data:/* @__PURE__ */ new Uint8Array})))}mountReadonlyPackages(t){if(!Array.isArray(t))throw new _(`EINVAL`,`Packages must be an array`);if(t.length===0)return;if(t.length>this.maxInodes)throw new _(`ENOSPC`,`Package count exceeds inode quota`);if(this.lease)throw new _(`EBUSY`,`Mount changes require no snapshot lease`);let n=this.exportSnapshot(),r=[...n.mounts],i=this.nextInode,a=()=>{if(i>=2**53-1)throw new _(`ENOSPC`,`Filesystem inode identities exhausted`);return i++},o=new Map(n.entries.map(e=>[e.path,e]));for(let e of t){if(!e||!Array.isArray(e.entries))throw new _(`EINVAL`,`Invalid readonly package`);let{path:t,entries:n}=e;if(x(t),!t.startsWith(`/`)||C(S(t))!==t||S(t).some(e=>e===`.`||e===`..`)||t===`/`)throw new _(`EINVAL`,`Mount path must be canonical and absolute`);if(r.some(({path:e})=>e!==`/`&&(T(t,e)||T(e,t))))throw new _(`EBUSY`,`Cannot overlap an existing or staged mount`);if([...o.keys()].some(e=>T(e,t)&&e!==t))throw new _(`EBUSY`,`Mount destination is not empty`);if(o.has(t)&&o.get(t).type!==`directory`)throw new _(`ENOTDIR`,`Mount destination is not a directory`);let i=``;for(let e of S(t)){if(i+=`/${e}`,o.has(i)&&o.get(i).type!==`directory`)throw new _(`ENOTDIR`,`Mount parent is not a directory`);if(o.has(i)||o.set(i,{inode:a(),path:i,type:`directory`,mode:493}),o.size>this.maxInodes)throw new _(`ENOSPC`,`Package tree exceeds inode quota`)}if(n.length>this.maxInodes-o.size)throw new _(`ENOSPC`,`Package tree exceeds inode quota`);let s=/* @__PURE__ */ new Set;for(let e of n){if(!e||typeof e!=`object`)throw new _(`EINVAL`,`Invalid readonly package entry`);if(x(e.path),e.path.startsWith(`/`)||S(e.path).join(`/`)!==e.path||S(e.path).some(e=>e===`.`||e===`..`)||s.has(e.path))throw new _(`EINVAL`,`Package entries need unique canonical relative paths`);s.add(e.path),o.set(`${t}/${e.path}`,{...e,inode:a(),path:`${t}/${e.path}`})}r.push({path:t,readonly:!0})}let s=e.fromSnapshot({generation:this.revision+1,nextInode:i,mounts:r,entries:[...o.values()]},{maxBytes:this.maxBytes,maxInodes:this.maxInodes});for(let{path:e,entries:n}of t)for(let t of n)if(t.type===`symlink`)try{s.resolve(`${e}/${t.path}`,{root:e})}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e}let c=new Map([...this.nodes].map(e=>[e.inode,e])),l=[...this.nodes].filter(e=>!e.linked),u=l.reduce((e,t)=>e+t.data.length+y.encode(t.target).length,0);if(s.nodes.size+l.length>this.maxInodes||s.usedBytes+u>this.maxBytes)throw new _(`ENOSPC`,`Package exceeds quota including open unlinked files`);let d=new Map([...s.nodes].map(e=>[e.inode,c.get(e.inode)??e]));for(let e of d.values())c.has(e.inode)||this.invalidateVersion(e);let f=[...s.nodes].map(e=>({node:d.get(e.inode),mount:e.mount,parent:e.parent===void 0?void 0:d.get(e.parent.inode),name:e.name,children:new Map([...e.children].map(([e,t])=>[e,d.get(t.inode)]))})),p=/* @__PURE__ */ new Set([...d.values(),...l]);for(let e of f)e.node.children=e.children,e.node.mount=e.mount,e.node.parent=e.parent,e.node.name=e.name;this.root=d.get(s.root.inode),this.nodes=p,this.mounts=s.mounts,this.usedBytes=s.usedBytes+u,this.nextInode=s.nextInode,this.advanceGeneration(),this.notify({kind:`rescan`,path:`/`})}};const j=[`created`,`resolving`,`preparing`,`starting`,`running`,`exiting`,`exited`];var M=class{#e=`created`;#t;#n;exited=new Promise(e=>{this.#n=e});get state(){return this.#e}transition(e){if(this.#t||e===`exited`||e!==`exiting`&&j.indexOf(e)!==j.indexOf(this.#e)+1)throw new g(`STARTUP_FAILED`,`Invalid process transition ${this.#e} → ${e}`);this.#e=e}finish(e){if(this.#t)return!1;if(e.reason===`exited`!=(e.code!==null)||e.code!==null&&(!Number.isSafeInteger(e.code)||e.code<0))throw new g(`INVALID_ARGUMENT`,`Invalid process result`);return this.#t=Object.freeze({...e}),this.#e=`exited`,this.#n(this.#t),!0}};function N(e,t,n={}){let r=e=>typeof e==`string`&&!e.includes(`\0`),i=Array.isArray(t)?Array.from(t):void 0;if(!r(e)||!e||!i||!i.every(r))throw new g(`INVALID_ARGUMENT`,`Command and argv must be NUL-free strings`);if(typeof n!=`object`||!n)throw new g(`INVALID_ARGUMENT`,`Spawn options must be an object`);let a=n.cwd??`/workspace`;if(!r(a)||!a.startsWith(`/`))throw new g(`INVALID_ARGUMENT`,`cwd must be an absolute NUL-free path`);let o=Object.create(null);for(let[e,t]of Object.entries(n.env??{})){if(!r(e)||!e||e.includes(`=`)||!r(t))throw new g(`INVALID_ARGUMENT`,`Invalid environment entry`);o[e]=t}let s=n.timeoutMs;if(s!==void 0&&(!Number.isSafeInteger(s)||s<1||s>2147483647))throw new g(`INVALID_ARGUMENT`,`timeoutMs must be a positive timer-safe integer`);let c=n.signal;if(c!==void 0&&(!c||typeof c!=`object`||typeof c.aborted!=`boolean`||typeof c.addEventListener!=`function`||typeof c.removeEventListener!=`function`))throw new g(`INVALID_ARGUMENT`,`signal must provide the AbortSignal event interface`);return Object.freeze({command:e,args:Object.freeze(i),cwd:a,env:Object.freeze(o),timeoutMs:s,signal:c})}var P=class extends Error{code;constructor(e,t=e){super(t),this.code=e,this.name=`PipeError`}};function F(e=65536){if(!Number.isSafeInteger(e)||e<1||e>16777216)throw new P(`EINVAL`,`Pipe capacity must be 1..16777216 bytes`);let t=new Uint8Array(e),n=0,r=0,i=0,a=0,o,s=/* @__PURE__ */ new Set,c=()=>{for(let e of s)e();s.clear()},l=()=>new Promise(e=>s.add(e)),u=e=>{if(e)throw new P(`EBADF`);if(o!==void 0)throw o},d=()=>{i++;let o=!1;return{async read(i){if(u(o),!Number.isSafeInteger(i)||i<0)throw new P(`EINVAL`);if(i===0)return/* @__PURE__ */ new Uint8Array;for(;r===0&&a!==0;)await l(),u(o);u(o);let s=Math.min(i,r),d=new Uint8Array(s);for(let r=0;r<s;r++)d[r]=t[(n+r)%e];return n=(n+s)%e,r-=s,c(),d},dup(){return u(o),d()},close(){if(o)throw new P(`EBADF`);o=!0,i--,c()}}},f=()=>{a++;let o=!1;return{async write(a){if(u(o),!(a instanceof Uint8Array))throw new P(`EINVAL`);if(a.length===0)return 0;for(;r===e&&i!==0;)await l(),u(o);if(u(o),i===0)throw new P(`EPIPE`);let s=Math.min(a.length,e-r);for(let i=0;i<s;i++)t[(n+r+i)%e]=a[i];return r+=s,c(),s},dup(){return u(o),f()},close(){if(o)throw new P(`EBADF`);o=!0,a--,c()}}};return{reader:d(),writer:f(),get bufferedBytes(){return r},get capacity(){return e},abort(e=new P(`EPIPE`)){o??=e,c()}}}function I(e,t=65536){if(!Number.isSafeInteger(t)||t<1)throw new P(`EINVAL`,`chunkBytes must be a positive integer`);let n=!1,r=()=>{n||(n=!0,e.close())};return new ReadableStream({async pull(n){try{let i=await e.read(t);i.length?n.enqueue(i):(r(),n.close())}catch(e){r(),n.error(e)}},cancel(){r()}},{highWaterMark:0})}const L=(e,t,n)=>{if(!Number.isSafeInteger(e)||e<1||e>n)throw new g(`INVALID_ARGUMENT`,`Invalid ${t}`);return e};function R(e){if(e===void 0)return;let t=()=>new g(`INVALID_ARGUMENT`,`Invalid delegated stdio`);if(!e||typeof e!=`object`||Array.isArray(e))throw t();let n={stdin:`read`,stdout:`write`,stderr:`write`},r={};for(let[i,a]of Object.entries(e)){if(!(i in n))throw t();let e=n[i];if(a!==null&&(!a||typeof a!=`object`||typeof a[e]!=`function`||typeof a.close!=`function`))throw t();r[i]=a}return Object.freeze(r)}function ee(e){let t=0;return new ReadableStream({async pull(n){let r=await e;if(t===r.length){n.close();return}let i=Math.min(r.length,t+65536);n.enqueue(r.slice(t,i)),t=i}},{highWaterMark:0})}var z=class{fs;packages;workspace;#e=/* @__PURE__ */ new Set;#t=/* @__PURE__ */ new Map;#n=/* @__PURE__ */ new Map;#r=/* @__PURE__ */ new Map;#i=/* @__PURE__ */ new Map;#a;#o;#s=0;#c;#l=1;#u=!1;#d;#f=new AbortController;get disposalSignal(){return this.#f.signal}constructor(e={}){if(this.packages=e.packages,this.packages?.resolveCommand(`wasm-run`))throw new g(`INVALID_ARGUMENT`,`wasm-run is a reserved command`);if(this.workspace=e.workspace,this.workspace&&(!(this.workspace.fs instanceof A)||this.workspace.inspect().state===`disposed`||e.maxBytes!==void 0&&e.maxBytes!==this.workspace.fs.maxBytes||e.maxInodes!==void 0&&e.maxInodes!==this.workspace.fs.maxInodes))throw new g(`INVALID_ARGUMENT`,`Workspace owner and container quotas must agree`);this.fs=this.workspace?.fs??new A({maxBytes:e.maxBytes,maxInodes:e.maxInodes}),this.#a=Object.freeze({maxWorkspaceBytes:L(this.fs.maxBytes,`maxBytes`,2**32),maxWorkspaceInodes:L(this.fs.maxInodes,`maxInodes`,1e6),maxMemoryBytes:L(e.maxMemoryBytes??67108864,`maxMemoryBytes`,2**32),maxInputBytes:L(e.maxInputBytes??8388608,`maxInputBytes`,268435456),maxOutputBytes:L(e.maxOutputBytes??8388608,`maxOutputBytes`,268435456)}),this.#o=L(e.maxProcesses??4,`maxProcesses`,256),this.#c=e.artifactAdapter??`wasi-preview1`;for(let t of e.adapters??[]){if(!t.id||![`snapshot`,`live`].includes(t.filesystem)||this.#r.has(t.id))throw new g(`INVALID_ARGUMENT`,`Invalid or duplicate adapter`);this.#r.set(t.id,t)}if(e.artifactAdapter!==void 0&&!this.#r.has(e.artifactAdapter))throw new g(`INVALID_ARGUMENT`,`Artifact adapter must be explicitly registered`);for(let[t,n]of Object.entries(e.commands??{})){if(t===`wasm-run`||this.packages?.resolveCommand(t))throw new g(`INVALID_ARGUMENT`,`Reserved command: ${t}`);if(N(t,[],{}),!(n.bytes instanceof Uint8Array)||!this.#r.has(n.adapter))throw new g(`INVALID_ARGUMENT`,`Invalid command: ${t}`);n.argv0!==void 0&&N(n.argv0,[]),this.#n.set(t,Object.freeze({...n,bytes:Uint8Array.from(n.bytes)}))}}spawn(e,t=[],n={}){return this.#p(e,t,n)}async#p(e,t,n,r){let i=N(e,t,n),a=R(n.stdio);if(this.#u)throw new g(`DISPOSED`,`Container has been disposed`);if(this.workspace?.inspect().state===`disposed`)throw new g(`DISPOSED`,`Workspace owner has been disposed`);if(i.signal?.aborted)throw new g(`ABORTED`,`Command aborted before startup`);if(new TextEncoder().encode(JSON.stringify([e,i.args,i.env])).length>1048576)throw new g(`RESOURCE_LIMIT`,`Invocation exceeds one MiB`);if(!r&&this.#i.size+this.#s>=this.#o||this.#l>=2**53-1)throw new g(`RESOURCE_LIMIT`,`Process admission limit reached`);let o=this.#n.get(e),s=this.packages?.resolveCommand(e),c=i.args;if(e===`wasm-run`){if(!i.args.length)throw new g(`INVALID_ARGUMENT`,`wasm-run requires a workspace path`);let e=i.args[0];o={adapter:this.#c,bytes:this.fs.readFile(e,{cwd:i.cwd}),argv0:e},c=i.args.slice(1)}if(!o&&!s)throw new g(`COMMAND_NOT_FOUND`,`Unknown command: ${e}`);let l=o?.adapter??s.adapter;if(!this.#r.has(l))throw new g(`UNSUPPORTED_PROFILE`,`Adapter is not registered: ${l}`);if(this.fs.stat(i.cwd).type!==`directory`)throw new g(`INVALID_ARGUMENT`,`cwd must name a directory`);let u=this.#r.get(l);if(a&&u.filesystem!==`live`)throw new g(`UNSUPPORTED_PROFILE`,`Delegated stdio requires a live adapter`);let d=this.#l++,f=new M,p=new AbortController,m=Object.freeze({}),h,_,v,y,b,x=`terminated`,S=!1,C=0,w=!1,T=[],E,D,O=new Promise((e,t)=>{E=e,D=t});O.catch(()=>{});let k,A,j=ee(new Promise(e=>{k=e})),P=ee(new Promise(e=>{A=e})),F=(e,t)=>v??=(async()=>{b!==void 0&&clearTimeout(b);try{i.signal?.removeEventListener(`abort`,L)}catch{e={code:null,reason:`runtime-error`}}p.signal.removeEventListener(`abort`,I),w=!0,T.length=0,D(new g(`ABORTED`,`Command stopped`));try{let e=h;h=void 0,await e?.dispose()}catch{e={code:null,reason:`runtime-error`}}finally{_?.discard(),y?.release(),_=void 0,y=void 0,k(t?.stdout??/* @__PURE__ */ new Uint8Array),A(t?.stderr??/* @__PURE__ */ new Uint8Array),this.#i.delete(d),f.finish(e)}})(),I=()=>{S&&F({code:null,reason:x})};p.signal.addEventListener(`abort`,I,{once:!0});let L=()=>p.abort(i.signal?.reason),z=async()=>{p.abort(),S?await F({code:null,reason:x}):await f.exited};r&&(r.remaining--,this.#s--),this.#i.set(d,{command:e,lifecycle:f,stop:z});try{i.signal?.addEventListener(`abort`,L,{once:!0}),i.signal?.aborted&&L(),i.timeoutMs!==void 0&&(b=setTimeout(()=>{x=`timeout`,p.abort()},i.timeoutMs)),f.transition(`resolving`),p.signal.throwIfAborted(),f.transition(`preparing`);let t=s&&this.#t.get(s.name);if(t)o={adapter:t.command.adapter,argv0:t.command.argv0,bytes:this.fs.readFile(t.executablePath)},c=Object.freeze([...t.command.prefixArgs,...i.args]);else if(s){let t=await this.packages.prepareCommand(e,{signal:p.signal});p.signal.throwIfAborted();let n=t.packages.filter(e=>!this.#e.has(`${t.distributionSha256}:${e.identity}:${e.mount}`)),r=n.map(e=>{let t=/* @__PURE__ */ new Map;for(let n of e.files){let e=n.path.split(`/`);for(let n=1;n<e.length;n++){let r=e.slice(0,n).join(`/`);t.set(r,{path:r,type:`directory`,mode:365})}t.set(n.path,{path:n.path,type:`file`,mode:n.executable?365:292,data:n.bytes})}return{path:e.mount,entries:[...t.values()]}});r.length&&this.fs.withMutationSource(m,()=>this.fs.mountReadonlyPackages(r));for(let e of n)this.#e.add(`${t.distributionSha256}:${e.identity}:${e.mount}`);let a=new Map(t.packages.map(e=>[e.id,e.mount]));for(let e of this.packages.listCommands()){let t=a.get(e.package);t&&this.#t.set(e.name,Object.freeze({command:e,executablePath:`${t}/${e.path}`}))}o={adapter:t.command.adapter,argv0:t.command.argv0,bytes:t.executable},c=Object.freeze([...t.command.prefixArgs,...i.args])}p.signal.throwIfAborted(),f.transition(`starting`);let n={command:o,invocation:{command:e,args:c,cwd:i.cwd,env:i.env},limits:this.#a,generation:d,mutationSource:m,signal:p.signal},r;u.filesystem===`live`?(y=this.fs.acquireLive(),h=r=await u.start({...n,fs:this.fs,...a?{stdio:a}:{}})):(_=this.fs.acquireSnapshot(),h=await u.start({...n,snapshot:_.snapshot})),p.signal.throwIfAborted(),f.transition(`running`),S=!0;let l=r?.stdin??new WritableStream({write:e=>{if(w)throw new g(`ABORTED`,`Command stdin is closed`);if(!(e instanceof Uint8Array))throw new g(`INVALID_ARGUMENT`,`stdin requires bytes`);if(C+e.length>this.#a.maxInputBytes)throw p.abort(),new g(`RESOURCE_LIMIT`,`Batch stdin exceeds configured limit`);e.length&&(T.push(Uint8Array.from(e)),C+=e.length)},close:()=>{if(w)return;w=!0;let e=new Uint8Array(C),t=0;for(let n of T)e.set(n,t),t+=n.length;T.length=0,E(e)},abort:()=>{p.abort()}});return(async()=>{try{if(r){let e=await r.run();if(p.signal.aborted||v)return;if(!e||!Number.isSafeInteger(e.code)||e.code<0||e.code>4294967295)throw new g(`STARTUP_FAILED`,`Adapter returned an invalid completion`);await F({code:e.code,reason:`exited`});return}let e=await h.run(await O);if(p.signal.aborted||v)return;if(!e||!Number.isSafeInteger(e.code)||e.code<0||e.code>4294967295||!(e.stdout instanceof Uint8Array)||!(e.stderr instanceof Uint8Array)||e.stdout.length+e.stderr.length>this.#a.maxOutputBytes)throw new g(`STARTUP_FAILED`,`Adapter returned an invalid completion`);try{_.commit(e.snapshot)}catch{await F({code:null,reason:`filesystem-conflict`});return}await F({code:e.code,reason:`exited`},e)}catch{await F({code:null,reason:p.signal.aborted?x:`runtime-error`})}})(),Object.freeze({pid:d,mutationSource:m,stdin:l,stdout:r?.stdout??j,stderr:r?.stderr??P,exited:f.exited,terminate:z})}catch(e){throw await F({code:null,reason:p.signal.aborted?x:`runtime-error`}),p.signal.aborted?new g(`ABORTED`,`Command cancelled during startup`,{cause:e}):e instanceof g?e:new g(`STARTUP_FAILED`,`Command could not start`,{cause:e})}}async spawnPipeline(e,t={}){if(this.#u)throw new g(`DISPOSED`,`Container has been disposed`);if(!Array.isArray(e)||e.length<2)throw new g(`INVALID_ARGUMENT`,`A pipeline requires at least two commands`);if(t.stdio!==void 0)throw new g(`INVALID_ARGUMENT`,`Pipelines own their stdio`);if(e.length>this.#o-this.#i.size-this.#s)throw new g(`RESOURCE_LIMIT`,`Cannot reserve all pipeline processes`);let n=e.map(e=>{if(!e||typeof e!=`object`)throw new g(`INVALID_ARGUMENT`,`Invalid pipeline command`);let n=N(e.command,e.args??[],t),r=e.command===`wasm-run`?this.#c:this.#n.get(e.command)?.adapter??this.packages?.resolveCommand(e.command)?.adapter;if(!r||this.#r.get(r)?.filesystem!==`live`)throw new g(`UNSUPPORTED_PROFILE`,`Pipelines require registered live adapters`);return{command:e.command,invocation:n}}),r={remaining:e.length};this.#s+=e.length;let i=[];try{for(let e of[...n].reverse()){let{invocation:t}=e;i.unshift(await this.#p(e.command,t.args,t,r))}let e=async()=>{await Promise.all(i.map(e=>e.terminate()))},t=i.slice(0,-1).map((t,n)=>t.stdout.pipeTo(i[n+1].stdin).catch(async t=>{t instanceof P&&t.code===`EPIPE`||await e()})),a=Promise.all(i.map(e=>e.exited)).then(async e=>(await Promise.all(t),Object.freeze(e)));return Object.freeze({processes:Object.freeze(i),stdin:i[0].stdin,stdout:i.at(-1).stdout,stderr:Object.freeze(i.map(e=>e.stderr)),exited:a,terminate:e})}catch(e){throw await Promise.all(i.map(e=>e.terminate())),e}finally{this.#s-=r.remaining}}async run(e,t=[],n={}){let r=L(n.maxCaptureBytes??8388608,`maxCaptureBytes`,268435456);if(n.stdin!==void 0&&!(n.stdin instanceof Uint8Array))throw new g(`INVALID_ARGUMENT`,`stdin requires bytes`);if(n.stdio!==void 0)throw new g(`INVALID_ARGUMENT`,`run captures its own stdio; use spawn to delegate it`);let i=n.stdin===void 0?void 0:Uint8Array.from(n.stdin),a=await this.spawn(e,t,n),o=0,s=async e=>{let t=e.getReader(),n=[],i=0;try{for(;;){let{value:e,done:a}=await t.read();if(a)break;if(o+=e.length,o>r)throw new g(`CAPTURE_LIMIT`,`Combined stdout/stderr capture exceeds its limit`);n.push(e),i+=e.length}let e=new Uint8Array(i),a=0;for(let t of n)e.set(t,a),a+=t.length;return e}finally{t.releaseLock()}},c=async()=>{let e=a.stdin.getWriter();try{i?.length&&await e.write(i),await e.close()}catch(e){if(!(e instanceof P)||e.code!==`EPIPE`)throw e}finally{e.releaseLock()}};try{let[e,t,n]=await Promise.all([s(a.stdout),s(a.stderr),a.exited,c()]);return{...n,stdout:e,stderr:t}}catch(e){throw await a.terminate(),e}}async inspect(){return{disposed:this.#u,profile:[...this.#r.values()].some(e=>e.filesystem===`live`)?`isolated`:`batch`,persistence:this.workspace?`opfs`:`memory`,...this.workspace?{workspace:this.workspace.inspect()}:{},...this.packages?{packages:this.packages.inspect()}:{},limits:this.#a,processes:[...this.#i].map(([e,t])=>({pid:e,generation:e,command:t.command,state:t.lifecycle.state}))}}async flush(){if(this.#u)throw new g(`DISPOSED`,`Container has been disposed`);if(!this.workspace)throw new g(`UNSUPPORTED_PROFILE`,`This workspace is memory-only; open a persistence owner explicitly`);await this.workspace.flush()}dispose(){return this.#d||(this.#u=!0,this.#d=Promise.all([...this.#i.values()].map(e=>e.stop())).then(()=>{}),this.#f.abort(new g(`DISPOSED`,`Container has been disposed`))),this.#d}};function te(e={}){return new z(e)}const ne=e=>e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`);var re=class{maxBytes;maxEntries;entries=/* @__PURE__ */ new Map;inFlight=/* @__PURE__ */ new Map;inFlightKeyBytes=0;identities=/* @__PURE__ */ new WeakMap;nextIdentity=0;bytes=0;hits=0;misses=0;disposed=!1;constructor(e=268435456,t=64){if(this.maxBytes=e,this.maxEntries=t,!Number.isSafeInteger(e)||e<0||!Number.isSafeInteger(t)||t<0)throw TypeError(`Runtime cache limits must be non-negative safe integers`)}identity(e){if(!e)return 0;let t=this.identities.get(e);return t===void 0&&(t=++this.nextIdentity,this.identities.set(e,t)),t}get(e){if(this.disposed)return;let t=this.entries.get(e);if(!t){this.misses++;return}return this.hits++,this.entries.delete(e),this.entries.set(e,t),t.value}set(e,t,n){if(this.disposed)return;if(!Number.isSafeInteger(n)||n<0)throw TypeError(`Invalid cache byte count`);let r=n+e.length*2;if(this.maxEntries===0||r>this.maxBytes)return;let i=this.entries.get(e);for(i&&(this.bytes-=i.bytes),this.entries.delete(e),this.entries.set(e,{value:t,bytes:r}),this.bytes+=r;this.entries.size>this.maxEntries||this.bytes>this.maxBytes;){let e=this.entries.keys().next().value;this.bytes-=this.entries.get(e).bytes,this.entries.delete(e)}}share(e,t,n,r){if(t.aborted)return Promise.reject(ne(t));let i=this.inFlight.get(e);if(!i){if(this.disposed||this.inFlight.size>=this.maxEntries||this.inFlightKeyBytes+e.length*2>this.maxBytes)return Promise.resolve().then(()=>{if(t.aborted)throw ne(t);return n(t,e=>r?.(e))});let a={controller:new AbortController,promise:void 0,consumers:/* @__PURE__ */ new Set,progress:/* @__PURE__ */ new Map,settled:!1,keyBytes:e.length*2};this.inFlight.set(e,a),this.inFlightKeyBytes+=a.keyBytes,a.promise=Promise.resolve().then(()=>{if(a.controller.signal.aborted)throw ne(a.controller.signal);return n(a.controller.signal,(e,t=``)=>{a.progress.set(t,e);for(let t of a.consumers)try{t(e)}catch{}})});let o=()=>{a.settled=!0,a.progress.clear(),this.removeOperation(e,a)};a.promise.then(o,o),i=a}let a=i;return new Promise((n,i)=>{let o=!0,s=e=>{o&&r?.(e)},c=()=>{o=!1,t.removeEventListener(`abort`,l),a.consumers.delete(s),!a.settled&&a.consumers.size===0&&(this.removeOperation(e,a),a.controller.abort(ne(t)))},l=()=>{o&&(c(),i(ne(t)))};a.consumers.add(s),t.addEventListener(`abort`,l,{once:!0}),a.promise.then(e=>{o&&(c(),n(e))},e=>{o&&(c(),i(e))});for(let e of a.progress.values())try{s(e)}catch{}t.aborted&&l()})}removeOperation(e,t){this.inFlight.get(e)===t&&(this.inFlight.delete(e),this.inFlightKeyBytes-=t.keyBytes)}stats(){return{hits:this.hits,misses:this.misses,entries:this.entries.size,bytes:this.bytes,inFlight:this.inFlight.size,disposed:this.disposed}}dispose(){this.disposed||(this.disposed=!0,this.entries.clear(),this.inFlight.clear(),this.inFlightKeyBytes=0,this.identities=/* @__PURE__ */ new WeakMap,this.bytes=0)}};const ie=e=>e.reason??new DOMException(`Runtime Wasm module request aborted`,`AbortError`),ae=e=>WebAssembly.compile(e),oe=e=>{try{e.onmessage=null}catch{}try{e.onmessageerror=null}catch{}try{e.close()}catch{}};function se(e,t){return ce(e,t)}function ce(e,t,n){let r={bytes:t.receipt.bytes,sha256:t.receipt.sha256},{cache:i,maxAssetBytes:a,identity:o,compileKey:s}=t,c=t.compile??ae,l=t.acquireVerificationSlot,u=t.signal;if(!Number.isSafeInteger(a)||a<=0||!Number.isSafeInteger(r.bytes)||r.bytes<8||r.bytes>a||typeof r.sha256!=`string`||!/^[a-f0-9]{64}$/u.test(r.sha256))throw TypeError(`Runtime Wasm module receipt exceeds the asset limit or is invalid`);if(typeof o!=`string`||!o||typeof s!=`string`||!s)throw TypeError(`Runtime Wasm module service requires host authorization and compile keys`);if(!globalThis.crypto?.subtle)throw Error(`Runtime Wasm module verification requires Web Crypto`);if(n!==void 0&&(!(n instanceof Uint8Array)||n.byteLength!==r.bytes))throw TypeError(`Prepared runtime Wasm source must match its pinned receipt length`);let d=n!==void 0,f=d?Uint8Array.from(n):void 0,p=JSON.stringify([`runtime-wasm-module-v1`,o,r.bytes,r.sha256,s,a]),m=new AbortController,h=!1,g=!1,_=()=>{h||(h=!0,f=void 0,u?.removeEventListener(`abort`,y),oe(e))},v=()=>{f=void 0,m.abort(u?.aborted?ie(u):new DOMException(`Runtime Wasm module service closed`,`AbortError`)),_()},y=()=>v();return e.onmessageerror=v,e.onmessage=t=>{if(h)return;let n=t.data;if(n?.type===`cancel`){v();return}g||(g=!0,(async()=>{if(d?n?.type!==`prepare`||Object.keys(n).length!==1:n?.type!==`compile`||!(n.bytes instanceof ArrayBuffer)||n.bytes.byteLength!==r.bytes)throw Error(`Invalid runtime Wasm module request`);let t=f??new Uint8Array(n.bytes);f=void 0;let u=await l?.(m.signal);try{m.signal.throwIfAborted();let e=await crypto.subtle.digest(`SHA-256`,t);if(Array.from(new Uint8Array(e),e=>e.toString(16).padStart(2,`0`)).join(``)!==r.sha256)throw Error(`Runtime Wasm module integrity mismatch`)}finally{u?.()}m.signal.throwIfAborted();let g=i?.get(p);if(!g){let e=async e=>{e.throwIfAborted();let n=await c(t,e);if(e.throwIfAborted(),!(n instanceof WebAssembly.Module))throw Error(`Runtime Wasm compiler did not return a module`);return i?.set(p,n,r.bytes),n};g=i?await i.share(p,m.signal,e):await e(m.signal)}h||e.postMessage({type:`module`,module:g,...d?{receipt:r,identity:o,compileKey:s,maxAssetBytes:a}:{}})})().catch(t=>{try{h||e.postMessage({type:`error`,message:t instanceof Error?t.message:String(t)})}catch{}}).finally(_))},u?.addEventListener(`abort`,y,{once:!0}),u?.aborted?v():e.start(),{close:v}}function le(e){return de(e)}function ue(e){if(!(e.bytes instanceof Uint8Array))throw TypeError(`Prepared runtime Wasm source requires bytes`);return de(e,e.bytes)}function de(e,t){let n=new MessageChannel,r;try{r=ce(n.port1,e,t)}catch(e){throw oe(n.port1),oe(n.port2),e}return{port:n.port2,close(){r.close(),oe(n.port2)}}}const fe=/* @__PURE__ */ new Set([`application/javascript`,`text/javascript`]);async function B(e){let t=e.stage??`compressed`,n={runtimeId:e.runtimeId,profileId:e.profileId};if(!e.asset||e.asset.includes(`\0`))throw new s(`Runtime asset identity must be a non-empty safe string`,n);if(!ArrayBuffer.isView(e.bytes)||Object.prototype.toString.call(e.bytes)!==`[object Uint8Array]`)throw new s(`Runtime asset ${e.asset} did not provide byte data`,n);let r,i,a;if(typeof e.expected==`string`){if(t===`uncompressed`)throw new s(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,n);r=e.expected}else if(e.expected&&typeof e.expected==`object`){if(t===`compressed`)r=e.expected.sha256,i=e.expected.bytes,e.expected.uncompressedSha256===void 0&&e.expected.uncompressedBytes===void 0&&(a=e.expected.mediaType);else{if(e.expected.uncompressedSha256===void 0||e.expected.uncompressedBytes===void 0)throw new s(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,n);r=e.expected.uncompressedSha256,i=e.expected.uncompressedBytes,a=e.expected.mediaType}}else throw new s(`Runtime asset ${e.asset} has invalid integrity metadata`,n);if(!/^[a-f0-9]{64}$/u.test(r))throw new s(`Runtime asset ${e.asset} has an invalid expected ${t} SHA-256 digest`,n);if(i!==void 0&&(!Number.isSafeInteger(i)||i<0))throw new s(`Runtime asset ${e.asset} has an invalid expected ${t} byte size`,n);if(i!==void 0&&e.bytes.byteLength!==i)throw new s(`Runtime asset ${e.asset} ${t} size mismatch: expected ${i} bytes, received ${e.bytes.byteLength}`,n);if(a!==void 0){if(!a.includes(`/`))throw new s(`Runtime asset ${e.asset} has an invalid expected MIME type`,n);let t=e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase()||`missing`,r=a.trim().toLowerCase();if(t!==r&&!(fe.has(t)&&fe.has(r)))throw new s(`Runtime asset ${e.asset} MIME type mismatch: expected ${r}, received ${t}`,n)}if(!globalThis.crypto?.subtle)throw new s(`Web Crypto SHA-256 is unavailable`,n);let o=e.bytes.byteOffset===0&&e.bytes.byteLength===e.bytes.buffer.byteLength&&e.bytes.buffer instanceof ArrayBuffer?e.bytes.buffer:Uint8Array.from(e.bytes).buffer,c=new Uint8Array(await globalThis.crypto.subtle.digest(`SHA-256`,o)),l=Array.from(c,e=>e.toString(16).padStart(2,`0`)).join(``);if(l!==r)throw new s(`Runtime asset ${e.asset} ${t} SHA-256 mismatch: expected ${r}, received ${l}`,n);return Object.freeze({asset:e.asset,stage:t,sha256:l,bytes:e.bytes.byteLength,mediaType:a?e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase():void 0})}async function pe(e){let[t,n]=await Promise.all([B({asset:e.asset,bytes:e.compressed,expected:e.expected,stage:`compressed`,runtimeId:e.runtimeId,profileId:e.profileId}),B({asset:e.asset,bytes:e.uncompressed,expected:e.expected,stage:`uncompressed`,mimeType:e.mimeType,runtimeId:e.runtimeId,profileId:e.profileId})]);return Object.freeze({compressed:t,uncompressed:n})}const me=67108864;function he(e){let t=Object.freeze(V(e)),n=async e=>{if(!(!t.enabled||typeof e!=`string`||!e||e.length>65536))try{let n=await crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e)),r=Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``);return{url:`https://wasm-idle.invalid/.generated-assets/${t.namespace}/${r}`,validationKey:`generated-v1:${r}`}}catch{return}},r=(e,t)=>e.references.some(e=>e.url===t.url&&e.validationKey===t.validationKey);return Object.freeze({async read(e,i){H(i);let a=await n(e);if(a)return De(t,i,async(e,n,i)=>{let o=(await Ae(n)).find(e=>r(e,a));if(!o||o.bytes>Math.min(t.maxEntryBytes,t.maxBytes,me))return;let s=await e.match(U(t,o.sha256));try{if(!s)throw Error(`Generated artifact body is missing`);let e=await Ne(s,o.bytes,i);await Te(B({asset:a.url,bytes:e,expected:o}),i),H(i);try{Oe(o,{...a,sha256:o.sha256,bytes:o.bytes},t),await W(n,`readwrite`,e=>e.put(o))}catch{}return e}catch{H(i),await je(e,n,t,o);return}})},async write(e,i,a){if(H(a),!we(t)||!i.byteLength||i.byteLength>Math.min(t.maxBytes,t.maxEntryBytes,me))return!1;let o=await n(e);if(!o)return!1;let s=Uint8Array.from(i),c;try{c=Array.from(new Uint8Array(await crypto.subtle.digest(`SHA-256`,s)),e=>e.toString(16).padStart(2,`0`)).join(``)}catch{return!1}return await De(t,a,async(e,n)=>{let i=await Ae(n),l=new Set(i.map(e=>U(t,e.sha256)));for(let t of await e.keys())l.has(t.url)||await e.delete(t);for(let a of i)a.sha256!==c&&r(a,o)&&(a.references=a.references.filter(e=>e.url!==o.url||e.validationKey!==o.validationKey),a.references.length?await W(n,`readwrite`,e=>e.put(a)):await je(e,n,t,a));i=await Ae(n);let u=i.find(e=>e.sha256===c),d=u??{sha256:c,bytes:s.byteLength,lastUsed:0,references:[]};if(d.bytes!==s.byteLength||(Oe(d,{...o,sha256:c,bytes:s.byteLength},t),!await Fe(e,n,t,i,u?0:s.byteLength,+!u,c)))return!1;H(a),await e.put(U(t,c),new Response(s,{headers:{"Content-Type":`application/octet-stream`,"Content-Length":String(s.byteLength)}}));try{await W(n,`readwrite`,e=>e.put(d))}catch(n){throw u||await e.delete(U(t,c)),n}return!0})??!1},async remove(e,i){let a=await n(e);a&&await De(t,i,async(e,n)=>{for(let i of await Ae(n))r(i,a)&&(i.references=i.references.filter(e=>e.url!==a.url||e.validationKey!==a.validationKey),i.references.length?await W(n,`readwrite`,e=>e.put(i)):await je(e,n,t,i))})}})}const ge=Object.freeze({enabled:!0,maxBytes:536870912,maxEntryBytes:536870912,maxEntries:4096,storageReserveBytes:67108864,eviction:`lru`,namespace:`wasm-idle`,version:`1.5.0`}),_e=3e3,ve=/* @__PURE__ */ new Set;let ye={};function V(...e){return be([ye,...e])}function be(e){let t={...ge};for(let n of e)if(n===!1)t.enabled=!1;else if(n)for(let[e,r]of Object.entries(n))r!==void 0&&Object.hasOwn(ge,e)&&(t[e]=r);for(let e of[`maxBytes`,`maxEntryBytes`,`maxEntries`,`storageReserveBytes`])if(!Number.isSafeInteger(t[e])||t[e]<0)throw TypeError(`Invalid asset cache ${e}`);if(typeof t.enabled!=`boolean`||![`lru`,`none`].includes(t.eviction))throw TypeError(`Invalid asset cache policy`);if(typeof t.namespace!=`string`||!/^[a-zA-Z0-9._-]{1,100}$/u.test(t.namespace))throw TypeError(`Invalid asset cache namespace`);if(typeof t.version!=`string`||!t.version||t.version.length>256)throw TypeError(`Invalid asset cache version`);return t}function H(e){if(e?.aborted)throw e.reason===void 0?new DOMException(`Aborted`,`AbortError`):e.reason}function xe(e){return typeof e.url==`string`&&e.url.length>0&&e.url.length<=8192&&!e.url.includes(`\0`)&&typeof e.sha256==`string`&&/^[a-f0-9]{64}$/u.test(e.sha256)&&(e.bytes===void 0||Number.isSafeInteger(e.bytes)&&e.bytes>=0)&&(e.validationKey===void 0||typeof e.validationKey==`string`&&e.validationKey.length<=8192)&&(e.version===void 0||typeof e.version==`string`&&e.version.length>0&&e.version.length<=256)}function Se(e){let t={...e};if(!xe(t))throw TypeError(`Invalid runtime asset integrity identity`);return t}function Ce(e){return`wasm-idle-assets-v1:${e.namespace}`}function U(e,t){return`https://wasm-idle.invalid/.runtime-assets/${e.namespace}/${t}`}function we(e){try{return e.enabled&&e.maxBytes>0&&e.maxEntryBytes>0&&e.maxEntries>0&&globalThis.caches!==void 0&&globalThis.indexedDB!==void 0&&typeof globalThis.navigator?.locks?.request==`function`}catch{return!1}}function Te(e,t){return new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(t.reason)};e.then(e=>{t.removeEventListener(`abort`,i),t.aborted?r(t.reason):n(e)},e=>{t.removeEventListener(`abort`,i),r(e)}),t.aborted?i():t.addEventListener(`abort`,i,{once:!0})})}function Ee(e,t){return H(t),new Promise((n,r)=>{let i=!1,a=indexedDB.open(e,1),o=()=>{i=!0,t.removeEventListener(`abort`,o),r(t.reason)};t.addEventListener(`abort`,o,{once:!0}),a.onupgradeneeded=()=>{i?a.transaction?.abort():a.result.createObjectStore(`assets`,{keyPath:`sha256`})},a.onsuccess=()=>{t.removeEventListener(`abort`,o),i?a.result.close():(i=!0,n(a.result))},a.onerror=()=>{t.removeEventListener(`abort`,o),i=!0,r(a.error)}})}function W(e,t,n){return H(e.signal),new Promise((r,i)=>{let a=e.connection.transaction(`assets`,t),o=()=>{try{a.abort()}catch{}},s=setTimeout(o,_e);e.signal.addEventListener(`abort`,o,{once:!0});let c=()=>{clearTimeout(s),e.signal.removeEventListener(`abort`,o)},l;try{l=n(a.objectStore(`assets`))}catch(e){c();try{a.abort()}catch{}i(e);return}a.oncomplete=()=>{c(),e.signal.aborted?i(e.signal.reason):r(l.result)},a.onabort=()=>{c(),i(e.signal.aborted?e.signal.reason:a.error??/* @__PURE__ */ Error(`Asset cache database transaction failed`))}})}async function De(e,t,n,r=`exclusive`){if(H(t),!we(e))return;let i=new AbortController,a=()=>i.abort(t?.reason);t?.addEventListener(`abort`,a,{once:!0});let o=Ce(e),s=setTimeout(()=>{ve.add(o),i.abort(/* @__PURE__ */ Error(`Asset cache lock timed out`))},ve.has(o)?_e:3e4);try{return await Te(navigator.locks.request(o,{signal:i.signal,mode:r},async()=>{let t=i.signal;ve.delete(o),H(t),clearTimeout(s),s=setTimeout(()=>i.abort(/* @__PURE__ */ Error(`Asset cache operation timed out`)),_e);let r=await Ee(Ce(e),t);try{H(t);let i=await Te(caches.open(Ce(e)),t);H(t);let a=await n({match:(...e)=>(H(t),Te(i.match(...e),t)),keys:(...e)=>(H(t),Te(i.keys(...e),t)),put:async(...e)=>{H(t),await i.put(...e),H(t)},delete:async(...e)=>{H(t);let n=await i.delete(...e);return H(t),n}},{connection:r,signal:t},t);return H(t),a}finally{r.close()}}),i.signal)}catch{H(t);return}finally{clearTimeout(s),t?.removeEventListener(`abort`,a)}}function Oe(e,t,n){let r=t.version??n.version;if(!e.references.some(e=>e.version===r&&e.url===t.url&&e.validationKey===t.validationKey)){if(e.references.length>=4096)throw Error(`Asset cache reference limit reached`);e.references.push({version:r,url:t.url,validationKey:t.validationKey})}e.lastUsed=Date.now()}function ke(e){return!!e&&/^[a-f0-9]{64}$/u.test(e.sha256)&&Number.isSafeInteger(e.bytes)&&e.bytes>=0&&Number.isFinite(e.lastUsed)&&Array.isArray(e.references)&&e.references.length<=4096&&e.references.every(e=>typeof e?.version==`string`&&typeof e.url==`string`&&(e.validationKey===void 0||typeof e.validationKey==`string`))}async function Ae(e){let t=await W(e,`readonly`,e=>e.getAll());for(let n of t)ke(n)||await W(e,`readwrite`,e=>e.delete(n.sha256));return t.filter(ke)}async function je(e,t,n,r){await e.delete(U(n,r.sha256)),await W(t,`readwrite`,e=>e.delete(r.sha256))}async function Me(e){try{return H(e),await Te(Promise.resolve(navigator.storage?.estimate?.()),e)}catch{H(e);return}}async function Ne(e,t,n){H(n);let r=e.body?.getReader();if(!r)return/* @__PURE__ */ new Uint8Array;let i=[],a=0;try{for(;;){H(n);let{done:e,value:o}=await Te(r.read(),n);if(e)break;if(a+=o.byteLength,a>t)throw Error(`Cached asset exceeds expected size`);i.push(o)}}catch(e){throw r.cancel().catch(()=>{}),e}finally{r.releaseLock()}let o=new Uint8Array(a),s=0;for(let e of i)o.set(e,s),s+=e.byteLength;return o}async function Pe(e,t,n){let r=await Me(n);return typeof r?.quota!=`number`||typeof r.usage!=`number`||!Number.isFinite(r.quota)||!Number.isFinite(r.usage)?e.maxBytes:Math.max(0,Math.min(e.maxBytes,r.quota-r.usage+t-e.storageReserveBytes))}async function Fe(e,t,n,r,i,a,o){let s=r.reduce((e,t)=>e+t.bytes,0),c=r.length,l=await Pe(n,s,t.signal);if(i>l||a>n.maxEntries)return!1;let u=()=>s+i<=l&&c+a<=n.maxEntries;if(u())return!0;if(n.eviction===`none`)return!1;for(let i of[...r].sort((e,t)=>e.lastUsed-t.lastUsed||e.sha256.localeCompare(t.sha256)))if(i.sha256!==o&&(await je(e,t,n,i),s-=i.bytes,c--,u()))return!0;return u()}async function Ie(e){e={...e,identity:Se(e.identity)};let t=V(e.cache);if(H(e.signal),!t.enabled||e.identity.bytes!==void 0&&e.identity.bytes>Math.min(t.maxBytes,t.maxEntryBytes))return;let n=Symbol(`invalid cached asset body`),r=r=>async(i,a,o)=>{let s=await W(a,`readonly`,t=>t.get(e.identity.sha256));if(!s||!ke(s)||s.sha256!==e.identity.sha256||s.bytes>Math.min(t.maxBytes,t.maxEntryBytes)||e.identity.bytes!==void 0&&e.identity.bytes!==s.bytes||e.identity.validationKey!==void 0&&!s.references.some(t=>t.url===e.identity.url&&t.validationKey===e.identity.validationKey))return;let c=await i.match(U(t,e.identity.sha256));if(!c){if(!r)return n;await W(a,`readwrite`,e=>e.delete(s.sha256));return}let l;try{l=await Ne(c,Math.min(s.bytes,t.maxBytes,t.maxEntryBytes),o),await Te(B({asset:e.identity.url,bytes:l,expected:{sha256:e.identity.sha256,bytes:e.identity.bytes??s.bytes}}),o)}catch{if(H(o),!r)return n;await je(i,a,t,s);return}H(e.signal);try{await W(a,`readwrite`,n=>{let r=n.get(s.sha256);return r.onsuccess=()=>{try{let i=r.result;if(!i||!ke(i))return;Oe(i,e.identity,t),n.put(i)}catch{try{n.transaction.abort()}catch{}}},r})}catch{}return l},i=await De(t,e.signal,r(!1),`shared`);if(i!==n)return i;let a=await De(t,e.signal,r(!0));return a===n?void 0:a}async function Le(e){e={...e,identity:Se(e.identity)};let t=V(e.cache);if(H(e.signal),!t.enabled||!we(t)||e.bytes.byteLength>Math.min(t.maxBytes,t.maxEntryBytes))return!1;let n=Uint8Array.from(e.bytes);return await B({asset:e.identity.url,bytes:n,expected:{sha256:e.identity.sha256,bytes:e.identity.bytes}}),H(e.signal),await De(t,e.signal,async(r,i)=>{let a=await Ae(i),o=new Set(a.map(e=>U(t,e.sha256)));for(let e of await r.keys())o.has(e.url)||await r.delete(e);let s=a.find(t=>t.sha256===e.identity.sha256),c=s??{sha256:e.identity.sha256,bytes:n.byteLength,lastUsed:0,references:[]};if(c.bytes!==n.byteLength||(Oe(c,e.identity,t),!await Fe(r,i,t,a,s?0:n.byteLength,+!s,c.sha256)))return!1;H(e.signal),await r.put(U(t,c.sha256),new Response(n,{headers:{"Content-Type":`application/octet-stream`,"Content-Length":String(n.byteLength)}}));try{await W(i,`readwrite`,e=>e.put(c))}catch(e){throw s||await r.delete(U(t,c.sha256)),e}return!0})??!1}function Re(e,t){try{e.body?.cancel(t).catch(()=>{})}catch{}}function ze(e,t,n){return t?new Promise((r,i)=>{let a=!1,o=()=>{a=!0,t.removeEventListener(`abort`,o),i(t.reason??new DOMException(`Pinned asset request aborted`,`AbortError`))};t.addEventListener(`abort`,o,{once:!0}),e.then(e=>{t.removeEventListener(`abort`,o),a?n?.(e):r(e)},e=>{t.removeEventListener(`abort`,o),i(e)}),t.aborted&&o()}):e}async function Be(e){e.signal?.throwIfAborted();let t;try{t=new URL(e.url)}catch{throw new m(`Pinned asset URL must be absolute HTTP(S)`)}if(![`http:`,`https:`].includes(t.protocol)||t.username||t.password||t.hash)throw new m(`Pinned assets require an uncredentialed HTTP(S) URL`);let r={...e.receipt},i=e.maxAssetBytes??134217728,a=r.uncompressedSha256!==void 0||r.uncompressedBytes!==void 0;if(!Number.isSafeInteger(i)||i<=0||!/^[a-f0-9]{64}$/u.test(r.sha256)||r.bytes!==void 0&&(!Number.isSafeInteger(r.bytes)||r.bytes<0)||a&&(typeof r.uncompressedSha256!=`string`||!/^[a-f0-9]{64}$/u.test(r.uncompressedSha256)||!Number.isSafeInteger(r.uncompressedBytes)||r.uncompressedBytes<0)||r.mediaType!==void 0&&(typeof r.mediaType!=`string`||!r.mediaType.includes(`/`)))throw new m(`Invalid pinned asset receipt or byte limit`);let o=e=>new n(`Pinned runtime asset exceeds its byte limit`,{limit:i,actual:e});if(r.bytes!==void 0&&r.bytes>i)throw o(r.bytes);let s=V(e.persistentCache),c={...s,maxEntryBytes:Math.min(s.maxEntryBytes,i)},l={url:t.href,sha256:r.sha256,bytes:r.bytes,validationKey:JSON.stringify([`pinned-public-http-v2`,a,r.mediaType??``,i])},u=await Ie({identity:l,cache:c,signal:e.signal});if(u)return e.onProgress?.(u.byteLength,u.byteLength),e.signal?.throwIfAborted(),{bytes:u,stored:!0};let d=await(async()=>{e.signal?.throwIfAborted();let n=e.fetch??globalThis.fetch;if(typeof n!=`function`)throw new m(`Pinned asset fetch is unavailable`);let a=await ze(Promise.resolve().then(()=>(e.signal?.throwIfAborted(),n.call(globalThis,t.href,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,signal:e.signal}))),e.signal,t=>Re(t,e.signal?.reason)),s,c=()=>{try{s?.cancel(e.signal?.reason).catch(()=>{})}catch{}};try{if(e.signal?.throwIfAborted(),!a.ok||a.status===206||a.redirected||a.type===`opaque`||a.type===`opaqueredirect`||a.url!==t.href)throw Error(`Pinned asset did not return a complete response from its exact URL (${a.status})`);if(!a.body)throw Error(`Pinned asset response body is unavailable`);let n=a.headers.get(`content-length`);if(n!==null&&(!/^\d+$/u.test(n)||!Number.isSafeInteger(Number(n))))throw Error(`Pinned asset has an invalid content length`);if(n!==null&&Number(n)>i)throw o(Number(n));s=a.body.getReader(),e.signal?.addEventListener(`abort`,c,{once:!0});let l=new Uint8Array(Math.min(i,r.bytes??65536)),u=0;for(;;){e.signal?.throwIfAborted();let{done:t,value:n}=await ze(s.read(),e.signal);if(e.signal?.throwIfAborted(),t)break;if(Object.prototype.toString.call(n)!==`[object Uint8Array]`)throw Error(`Pinned asset stream returned non-byte data`);let a=u+n.byteLength;if(a>i||r.bytes!==void 0&&a>r.bytes)throw o(a);if(a>l.byteLength){let e=new Uint8Array(Math.min(i,Math.max(a,l.byteLength*2,65536)));e.set(l.subarray(0,u)),l=e}l.set(n,u),u=a,e.onProgress?.(u,r.bytes)}let d=l.slice(0,u);return await ze(B({asset:t.href,bytes:d,expected:r,mimeType:a.headers.get(`content-type`)??void 0}),e.signal),e.signal?.throwIfAborted(),d}catch(e){if(s)try{s.cancel(e).catch(()=>{})}catch{}else Re(a,e);throw e}finally{e.signal?.removeEventListener(`abort`,c);try{s?.releaseLock()}catch{}}})(),f=await Le({identity:l,cache:c,signal:e.signal,bytes:d});return e.onProgress?.(d.byteLength,d.byteLength),e.signal?.throwIfAborted(),{bytes:d,stored:f}}async function Ve(e){return(await Be(e)).bytes}function He(e){if(e.schemaVersion!==1)throw TypeError(`Unsupported runtime trust profile schema: ${String(e.schemaVersion)}`);if(!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(e.profileId))throw TypeError(`Runtime trust profile ID must be a non-empty stable identifier`);if(![`none`,`allowlist`,`unrestricted`].includes(e.network.mode))throw TypeError(`Unsupported runtime network mode: ${String(e.network.mode)}`);let t=e.network.allowedOrigins.map(e=>{let t;try{t=new URL(e)}catch{throw TypeError(`Runtime network allowlist contains an invalid origin: ${e}`)}if(t.protocol!==`https:`&&t.protocol!==`http:`||t.pathname!==`/`||t.search||t.hash||t.username||t.password)throw TypeError(`Runtime network allowlist requires HTTP(S) origins: ${e}`);return t.origin}),n=[...new Set(t)].sort();if(e.network.mode===`allowlist`&&n.length===0)throw TypeError(`Runtime network allowlist mode requires at least one origin`);if(e.network.mode!==`allowlist`&&n.length>0)throw TypeError(`Runtime network mode ${e.network.mode} cannot declare allowed origins`);if(![`none`,`ephemeral`,`persistent`].includes(e.storage.mode))throw TypeError(`Unsupported runtime storage mode: ${String(e.storage.mode)}`);if(![`none`,`allowlist`].includes(e.environment.mode))throw TypeError(`Unsupported runtime environment mode: ${String(e.environment.mode)}`);for(let t of e.environment.allowedNames)if(!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(t))throw TypeError(`Runtime environment allowlist contains an invalid name: ${t}`);let r=[...new Set(e.environment.allowedNames)].sort();if(e.environment.mode===`allowlist`&&r.length===0)throw TypeError(`Runtime environment allowlist mode requires at least one name`);if(e.environment.mode===`none`&&r.length>0)throw TypeError(`Runtime environment mode none cannot declare allowed names`);if(!Number.isSafeInteger(e.threads.maxThreads)||e.threads.maxThreads<0)throw TypeError(`Runtime maxThreads must be a non-negative safe integer`);if(!Number.isSafeInteger(e.workers.maxNestedWorkers)||e.workers.maxNestedWorkers<0)throw TypeError(`Runtime maxNestedWorkers must be a non-negative safe integer`);if(typeof e.sharedArrayBuffer!=`boolean`)throw TypeError(`Runtime sharedArrayBuffer capability must be boolean`);if(!e.sharedArrayBuffer&&e.threads.maxThreads>0)throw TypeError(`Runtime threads require SharedArrayBuffer capability`);if(![`none`,`wasm-only`,`javascript-and-wasm`].includes(e.dynamicCode))throw TypeError(`Unsupported runtime dynamic-code mode: ${String(e.dynamicCode)}`);if(typeof e.sameOriginAccess!=`boolean`)throw TypeError(`Runtime sameOriginAccess capability must be boolean`);return Object.freeze({schemaVersion:1,profileId:e.profileId,network:Object.freeze({mode:e.network.mode,allowedOrigins:Object.freeze(n)}),storage:Object.freeze({mode:e.storage.mode}),environment:Object.freeze({mode:e.environment.mode,allowedNames:Object.freeze(r)}),threads:Object.freeze({maxThreads:e.threads.maxThreads}),workers:Object.freeze({maxNestedWorkers:e.workers.maxNestedWorkers}),sharedArrayBuffer:e.sharedArrayBuffer,dynamicCode:e.dynamicCode,sameOriginAccess:e.sameOriginAccess})}function Ue(e,t,n,r){let i;try{i=new URL(String(t),r)}catch{throw new m(`Runtime network URL is invalid: ${String(t)}`)}if(i.protocol!==`https:`&&i.protocol!==`http:`)throw new m(`Runtime network URL uses an unsupported scheme: ${i.protocol}`);if(i.username||i.password)throw new m(`Runtime network URL cannot contain credentials: ${i.origin}`);if(e.network.mode===`none`)throw new m(`Runtime trust profile ${e.profileId} does not allow network access`);if(e.network.mode===`allowlist`&&!e.network.allowedOrigins.includes(i.origin))throw new m(`Runtime network origin ${i.origin} is not allowed by ${e.profileId}`);if(!e.sameOriginAccess){if(!n)throw new m(`Runtime page origin is required to enforce same-origin isolation`);if(i.origin===n)throw new m(`Runtime trust profile ${e.profileId} does not allow same-origin access`)}return i.href}function We(e,t={}){let n=He(e);if(t.environment!==void 0&&(!t.environment||typeof t.environment!=`object`||Array.isArray(t.environment)))throw new m(`Runtime environment must be a string record`);let r=Object.entries(t.environment??{}).sort(([e],[t])=>e.localeCompare(t));if(n.environment.mode===`none`&&r.length>0)throw new m(`Runtime trust profile ${n.profileId} does not allow environment variables`);for(let[e,t]of r){if(!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(e))throw new m(`Runtime environment name is invalid: ${e}`);if(typeof t!=`string`||t.includes(`\0`))throw new m(`Runtime environment value is invalid: ${e}`);if(n.environment.mode===`allowlist`&&!n.environment.allowedNames.includes(e))throw new m(`Runtime environment variable ${e} is not allowed by ${n.profileId}`)}let i;if(t.pageOrigin!==void 0){let e;try{e=new URL(t.pageOrigin)}catch{throw new m(`Runtime page origin is invalid: ${t.pageOrigin}`)}if(e.protocol!==`https:`&&e.protocol!==`http:`||e.pathname!==`/`||e.search||e.hash||e.username||e.password)throw new m(`Runtime page origin must be an HTTP(S) origin: ${t.pageOrigin}`);i=e.origin}let a=(t.networkUrls??[]).map(e=>Ue(n,e,i)),o=t.storage??`none`;if(![`none`,`ephemeral`,`persistent`].includes(o))throw new m(`Runtime storage request is invalid: ${String(o)}`);let s={none:0,ephemeral:1,persistent:2};if(s[o]>s[n.storage.mode])throw new m(`Runtime storage ${o} exceeds trust profile ${n.profileId}`);let c=t.threads??0;if(!Number.isSafeInteger(c)||c<0)throw new m(`Runtime thread request must be a non-negative integer`);if(c>n.threads.maxThreads)throw new m(`Runtime requested ${c} threads; trust profile limit is ${n.threads.maxThreads}`);let l=t.nestedWorkers??0;if(!Number.isSafeInteger(l)||l<0)throw new m(`Runtime nested-worker request must be a non-negative integer`);if(l>n.workers.maxNestedWorkers)throw new m(`Runtime requested ${l} nested workers; trust profile limit is ${n.workers.maxNestedWorkers}`);let u=t.sharedArrayBuffer??!1;if(typeof u!=`boolean`)throw new m(`Runtime SharedArrayBuffer request must be boolean`);if(u&&!n.sharedArrayBuffer)throw new m(`Runtime trust profile ${n.profileId} does not allow SharedArrayBuffer`);if(c>0&&!u)throw new m(`Runtime thread requests require SharedArrayBuffer access`);let d=t.dynamicCode??`none`;if(![`none`,`wasm-only`,`javascript-and-wasm`].includes(d))throw new m(`Runtime dynamic-code request is invalid: ${String(d)}`);let f={none:0,"wasm-only":1,"javascript-and-wasm":2};if(f[d]>f[n.dynamicCode])throw new m(`Runtime dynamic-code request ${d} exceeds trust profile ${n.profileId}`);let p=t.sameOriginAccess??!1;if(typeof p!=`boolean`)throw new m(`Runtime same-origin request must be boolean`);if(p&&!n.sameOriginAccess)throw new m(`Runtime trust profile ${n.profileId} does not allow same-origin access`);return Object.freeze({profile:n,environment:Object.freeze(Object.fromEntries(r)),networkUrls:Object.freeze([...new Set(a)].sort()),pageOrigin:i,storage:o,threads:c,nestedWorkers:l,sharedArrayBuffer:u,dynamicCode:d,sameOriginAccess:p})}He({schemaVersion:1,profileId:`restricted-browser-worker-v1`,network:{mode:`none`,allowedOrigins:[]},storage:{mode:`ephemeral`},environment:{mode:`none`,allowedNames:[]},threads:{maxThreads:0},workers:{maxNestedWorkers:0},sharedArrayBuffer:!1,dynamicCode:`wasm-only`,sameOriginAccess:!1});const Ge=Object.freeze(/* @__PURE__ */ `APL.MOONBIT.COQ.SMALLTALK.PICAT.WREN.SQUIRREL.C.C3.CPP.OBJC.OBJECTIVECXX.PYTHON3.JAVA.SCALA.RUST.GO.D.DART.CSHARP.FSHARP.VBNET.ELIXIR.ERLANG.PROLOG.GLEAM.GRAIN.VERILOG.PERL.TCL.AWK.PASCAL.FORTH.J.BQN.SML.BC.UIUA.JANET.JULIA.NIM.BASH.SED.CLOJURESCRIPT.RESCRIPT.HY.FORTRAN.LFORTRAN.LEAN4.COBOL.V.TINYGO.OCAML.JAVASCRIPT.COFFEESCRIPT.TYPESCRIPT.ASSEMBLYSCRIPT.WAT.WASM.WHITESPACE.MALBOLGE.AHEUI.UHMLANG.LOLCODE.APECODE.GOLFSCRIPT.BRAINFUCK.BEFUNGE93.LUA.FENNEL.ZIG.LISP.COMMONLISP.PARIGP.RUBY.HASKELL.R.OCTAVE.GRAPHQL.DUCKDB.SQLITE.POSTGRESQL.PHP`.split(`.`)),Ke=/* @__PURE__ */ new Set([`C`,`CPP`,`PYTHON3`,`JAVA`]);new Set(Ge.filter(e=>!Ke.has(e)));const qe={GNUAPL:{canonicalId:`APL`,kind:`implementation`},"GNU-APL":{canonicalId:`APL`,kind:`implementation`},"PARI/GP":{canonicalId:`PARIGP`,kind:`spelling`},GP:{canonicalId:`PARIGP`,kind:`implementation`},BEFUNGE:{canonicalId:`BEFUNGE93`,kind:`dialect`},"BEFUNGE-93":{canonicalId:`BEFUNGE93`,kind:`spelling`},BF:{canonicalId:`BRAINFUCK`,kind:`spelling`},"C#":{canonicalId:`CSHARP`,kind:`spelling`},"F#":{canonicalId:`FSHARP`,kind:`spelling`},VB:{canonicalId:`VBNET`,kind:`spelling`},VISUALBASIC:{canonicalId:`VBNET`,kind:`spelling`},OBJECTIVEC:{canonicalId:`OBJC`,kind:`spelling`},OBJECTIVE_C:{canonicalId:`OBJC`,kind:`spelling`},"OBJECTIVE-C":{canonicalId:`OBJC`,kind:`spelling`},OBJCXX:{canonicalId:`OBJECTIVECXX`,kind:`spelling`},OBJCPP:{canonicalId:`OBJECTIVECXX`,kind:`spelling`},OBJECTIVE_CXX:{canonicalId:`OBJECTIVECXX`,kind:`spelling`},"OBJECTIVE-C++":{canonicalId:`OBJECTIVECXX`,kind:`spelling`},ERL:{canonicalId:`ERLANG`,kind:`spelling`},LEAN:{canonicalId:`LEAN4`,kind:`spelling`},SWIPL:{canonicalId:`PROLOG`,kind:`implementation`},SWI:{canonicalId:`PROLOG`,kind:`implementation`},TCLSH:{canonicalId:`TCL`,kind:`implementation`},GAWK:{canonicalId:`AWK`,kind:`implementation`},PAS:{canonicalId:`PASCAL`,kind:`spelling`},FPC:{canonicalId:`PASCAL`,kind:`implementation`},GFORTH:{canonicalId:`FORTH`,kind:`implementation`},JL:{canonicalId:`JULIA`,kind:`spelling`},NIMROD:{canonicalId:`NIM`,kind:`spelling`},SH:{canonicalId:`BASH`,kind:`compatibility`},SHELL:{canonicalId:`BASH`,kind:`compatibility`},CLJS:{canonicalId:`CLOJURESCRIPT`,kind:`spelling`},RES:{canonicalId:`RESCRIPT`,kind:`spelling`},HYLANG:{canonicalId:`HY`,kind:`spelling`},F77:{canonicalId:`FORTRAN`,kind:`dialect`},COB:{canonicalId:`COBOL`,kind:`spelling`},CBL:{canonicalId:`COBOL`,kind:`spelling`},GNUCOBOL:{canonicalId:`COBOL`,kind:`implementation`},VLANG:{canonicalId:`V`,kind:`spelling`},DLANG:{canonicalId:`D`,kind:`spelling`},JS:{canonicalId:`JAVASCRIPT`,kind:`spelling`},COFFEE:{canonicalId:`COFFEESCRIPT`,kind:`spelling`},AS:{canonicalId:`ASSEMBLYSCRIPT`,kind:`spelling`},PYTHON:{canonicalId:`PYTHON3`,kind:`spelling`},PYPY3:{canonicalId:`PYTHON3`,kind:`implementation`,deprecated:!0,message:`PYPY3 runs the Pyodide implementation; use PYTHON3 instead.`},FNL:{canonicalId:`FENNEL`,kind:`spelling`},HS:{canonicalId:`HASKELL`,kind:`spelling`},RB:{canonicalId:`RUBY`,kind:`spelling`},SCHEME:{canonicalId:`LISP`,kind:`compatibility`,message:`SCHEME selects the bundled Puppy Scheme-compatible runtime.`},SCM:{canonicalId:`LISP`,kind:`compatibility`,message:`SCM selects the bundled Puppy Scheme-compatible runtime.`},CL:{canonicalId:`COMMONLISP`,kind:`spelling`},COMMON_LISP:{canonicalId:`COMMONLISP`,kind:`spelling`},"COMMON-LISP":{canonicalId:`COMMONLISP`,kind:`spelling`},ECL:{canonicalId:`COMMONLISP`,kind:`implementation`},TS:{canonicalId:`TYPESCRIPT`,kind:`spelling`},MATLAB:{canonicalId:`OCTAVE`,kind:`compatibility`,message:`MATLAB selects GNU Octave compatibility, not MATLAB.`},SQL:{canonicalId:`SQLITE`,kind:`dialect`,message:`SQL selects the SQLite dialect and engine.`},GQL:{canonicalId:`GRAPHQL`,kind:`spelling`},POSTGRES:{canonicalId:`POSTGRESQL`,kind:`spelling`},PGSQL:{canonicalId:`POSTGRESQL`,kind:`spelling`},PGLITE:{canonicalId:`POSTGRESQL`,kind:`implementation`,message:`PGLITE selects PostgreSQL running through the PGlite WebAssembly build.`},WASM32:{canonicalId:`WASM`,kind:`spelling`}};Object.freeze(Object.keys(qe));const Je=Object.freeze(Object.fromEntries(Object.entries(qe).map(([e,t])=>[e,Object.freeze({alias:e,deprecated:!1,...t})])));function Ye(e){let t=e.trim().toUpperCase();return Je[t]?.canonicalId??t}function Xe(e){return Ge.includes(e)}const Ze=e=>!!e,Qe=e=>Array.isArray(e)?e.join(`\0`):``,$e=e=>Array.isArray(e)?[...e].sort().join(`\0`):``,et=e=>{if(e===void 0)return``;if(e===!1)return`false`;if(!e||typeof e!=`object`||Array.isArray(e))throw TypeError(`Runtime persistent cache options must be false or an object`);return JSON.stringify(Object.fromEntries(Object.entries(e).filter(([,e])=>e!==void 0).sort(([e],[t])=>e.localeCompare(t))))},tt=e=>{if(e===void 0)return``;if(!Number.isSafeInteger(e)||e<0)throw TypeError(`Runtime asset integer identity must be a non-negative safe integer`);return String(e)},G=e=>{if(!e||typeof e!=`object`||Array.isArray(e))return``;let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>{if(e.startsWith(`/`)||e.includes(`\\`)||e.includes(`\0`)||e.includes(`?`)||e.includes(`#`)||e.split(`/`).some(e=>!e||e===`.`||e===`..`))throw TypeError(`Runtime integrity asset key must be normalized and relative: ${e}`);if(typeof t==`string`){if(!/^[a-f0-9]{64}$/u.test(t))throw TypeError(`Runtime integrity entry ${e} has an invalid SHA-256`);return[e,t]}if(!t||typeof t!=`object`||Array.isArray(t))throw TypeError(`Runtime integrity entry ${e} must be a digest or metadata object`);let n=t;if(typeof n.sha256!=`string`||!/^[a-f0-9]{64}$/u.test(n.sha256))throw TypeError(`Runtime integrity entry ${e} has an invalid SHA-256`);if(n.bytes!==void 0&&(!Number.isSafeInteger(n.bytes)||n.bytes<0))throw TypeError(`Runtime integrity entry ${e} has an invalid byte size`);if(n.mediaType!==void 0&&(typeof n.mediaType!=`string`||!n.mediaType.includes(`/`)))throw TypeError(`Runtime integrity entry ${e} has an invalid media type`);let r=n.uncompressedSha256!==void 0,i=n.uncompressedBytes!==void 0;if(r!==i)throw TypeError(`Runtime integrity entry ${e} requires both uncompressed digest and size`);if(r&&(typeof n.uncompressedSha256!=`string`||!/^[a-f0-9]{64}$/u.test(n.uncompressedSha256)))throw TypeError(`Runtime integrity entry ${e} has an invalid uncompressed SHA-256`);if(i&&(!Number.isSafeInteger(n.uncompressedBytes)||n.uncompressedBytes<0))throw TypeError(`Runtime integrity entry ${e} has an invalid uncompressed byte size`);return[e,{sha256:n.sha256,bytes:typeof n.bytes==`number`?n.bytes:void 0,mediaType:typeof n.mediaType==`string`?n.mediaType:void 0,uncompressedSha256:typeof n.uncompressedSha256==`string`?n.uncompressedSha256:void 0,uncompressedBytes:typeof n.uncompressedBytes==`number`?n.uncompressedBytes:void 0}]});return JSON.stringify(t)},K=e=>e===void 0?``:G({worker:e}),nt=/* @__PURE__ */ new WeakMap;let rt=0;const it=[{runtime:`python`,loaderProperty:`loader`,loaderKeyProperty:`loaderKey`,identityKey:`pythonLoaderIdentity`},{runtime:`java`,loaderProperty:`loader`,loaderKeyProperty:`loaderKey`,identityKey:`javaLoaderIdentity`},{runtime:`clang`,loaderProperty:`loader`,loaderKeyProperty:`loaderKey`,identityKey:`clangLoaderIdentity`},{runtime:`clangd`,loaderProperty:`loader`,loaderKeyProperty:`loaderKey`,identityKey:`clangdLoaderIdentity`},{runtime:`tinygo`,loaderProperty:`assetLoader`,loaderKeyProperty:`assetLoaderKey`,identityKey:`tinygoAssetLoaderIdentity`}],at=[{runtime:`python`,property:`persistentCache`,key:`pythonPersistentCache`,serialize:et},{runtime:`java`,property:`persistentCache`,key:`javaPersistentCache`,serialize:et},{runtime:`clang`,property:`persistentCache`,key:`clangPersistentCache`,serialize:et},{runtime:`clangd`,property:`persistentCache`,key:`clangdPersistentCache`,serialize:et},{runtime:`python`,property:`baseUrl`,key:`pythonBaseUrl`},{runtime:`python`,property:`loader`,key:`hasPythonLoader`,serialize:Ze},{runtime:`python`,property:`integrity`,key:`pythonIntegrity`,serialize:G},{runtime:`python`,property:`allowedBaseUrls`,key:`pythonAllowedBaseUrls`,serialize:$e},{runtime:`java`,property:`baseUrl`,key:`javaBaseUrl`},{runtime:`java`,property:`loader`,key:`hasJavaLoader`,serialize:Ze},{runtime:`java`,property:`integrity`,key:`javaIntegrity`,serialize:G},{runtime:`java`,property:`allowedBaseUrls`,key:`javaAllowedBaseUrls`,serialize:$e},{runtime:`clang`,property:`baseUrl`,key:`clangBaseUrl`},{runtime:`clang`,property:`loader`,key:`hasClangLoader`,serialize:Ze},{runtime:`clang`,property:`integrity`,key:`clangIntegrity`,serialize:G},{runtime:`clang`,property:`allowedBaseUrls`,key:`clangAllowedBaseUrls`,serialize:$e},{runtime:`clangd`,property:`baseUrl`,key:`clangdBaseUrl`},{runtime:`clangd`,property:`loader`,key:`hasClangdLoader`,serialize:Ze},{runtime:`clangd`,property:`integrity`,key:`clangdIntegrity`,serialize:G},{runtime:`clangd`,property:`allowedBaseUrls`,key:`clangdAllowedBaseUrls`,serialize:$e},{runtime:`rust`,property:`compilerUrl`,key:`rustCompilerUrl`},{runtime:`rust`,property:`manifestUrl`,key:`rustManifestUrl`},{runtime:`rust`,property:`debugModuleUrl`,key:`rustDebugModuleUrl`},{runtime:`rust`,property:`executableGraphFingerprint`,key:`rustExecutableGraphFingerprint`},{runtime:`rust`,property:`profileId`,key:`rustProfileId`},{runtime:`rust`,property:`protocolVersion`,key:`rustProtocolVersion`,serialize:tt},{runtime:`rust`,property:`manifestPath`,key:`rustManifestPath`},{runtime:`rust`,property:`manifestFingerprint`,key:`rustManifestFingerprint`},{runtime:`rust`,property:`manifestReceipt`,key:`rustManifestReceipt`,serialize:K},{runtime:`rust`,property:`assetReceipts`,key:`rustAssetReceipts`,serialize:G},{runtime:`go`,property:`compilerUrl`,key:`goCompilerUrl`},{runtime:`go`,property:`manifestUrl`,key:`goManifestUrl`},{runtime:`assemblyscript`,property:`moduleUrl`,key:`assemblyScriptModuleUrl`},{runtime:`duckdb`,property:`moduleUrl`,key:`duckDbModuleUrl`},{runtime:`d`,property:`moduleUrl`,key:`dModuleUrl`},{runtime:`d`,property:`manifestUrl`,key:`dManifestUrl`},{runtime:`d`,property:`integrity`,key:`dIntegrity`,serialize:G},{runtime:`dotnet`,property:`moduleUrl`,key:`dotnetModuleUrl`},{runtime:`elixir`,property:`bundleUrl`,key:`elixirBundleUrl`},{runtime:`elixir`,property:`integrity`,key:`elixirIntegrity`,serialize:G},{runtime:`erlang`,property:`bundleUrl`,key:`erlangBundleUrl`},{runtime:`erlang`,property:`integrity`,key:`erlangIntegrity`,serialize:G},{runtime:`ocaml`,property:`moduleUrl`,key:`ocamlModuleUrl`},{runtime:`ocaml`,property:`manifestUrl`,key:`ocamlManifestUrl`},{runtime:`ocaml`,property:`moduleReceipt`,key:`ocamlModuleReceipt`,serialize:K},{runtime:`ocaml`,property:`manifestReceipt`,key:`ocamlManifestReceipt`,serialize:K},{runtime:`tinygo`,property:`appUrl`,key:`tinygoAppUrl`},{runtime:`tinygo`,property:`moduleUrl`,key:`tinygoModuleUrl`},{runtime:`tinygo`,property:`executableGraphFingerprint`,key:`tinygoExecutableGraphFingerprint`},{runtime:`tinygo`,property:`profileId`,key:`tinygoProfileId`},{runtime:`tinygo`,property:`protocolVersion`,key:`tinygoProtocolVersion`,serialize:tt},{runtime:`tinygo`,property:`manifestPath`,key:`tinygoManifestPath`},{runtime:`tinygo`,property:`manifestFingerprint`,key:`tinygoManifestFingerprint`},{runtime:`tinygo`,property:`manifestReceipt`,key:`tinygoManifestReceipt`,serialize:K},{runtime:`tinygo`,property:`assetReceipts`,key:`tinygoAssetReceipts`,serialize:G},{runtime:`tinygo`,property:`assetLoader`,key:`hasTinyGoAssetLoader`,serialize:Ze},{runtime:`typescript`,property:`moduleUrl`,key:`typeScriptModuleUrl`},{runtime:`typescript`,property:`javascriptModuleUrl`,key:`javaScriptModuleUrl`},{runtime:`typescript`,property:`coffeeScriptModuleUrl`,key:`coffeeScriptModuleUrl`},{runtime:`typescript`,property:`libUrl`,key:`typeScriptLibUrl`},{runtime:`wat`,property:`moduleUrl`,key:`watModuleUrl`},{runtime:`lua`,property:`moduleUrl`,key:`luaModuleUrl`},{runtime:`fennel`,property:`compilerUrl`,key:`fennelCompilerUrl`},{runtime:`haskell`,property:`moduleUrl`,key:`haskellModuleUrl`},{runtime:`haskell`,property:`rootfsUrl`,key:`haskellRootfsUrl`},{runtime:`haskell`,property:`bsdtarUrl`,key:`haskellBsdtarUrl`},{runtime:`haskell`,property:`integrity`,key:`haskellIntegrity`,serialize:G},{runtime:`haskell`,property:`mainSoPath`,key:`haskellMainSoPath`},{runtime:`haskell`,property:`searchDirs`,key:`haskellSearchDirs`,serialize:Qe},{runtime:`lfortran`,property:`baseUrl`,key:`lfortranBaseUrl`},{runtime:`lean4`,property:`baseUrl`,key:`lean4BaseUrl`},{runtime:`commonlisp`,property:`baseUrl`,key:`commonlispBaseUrl`},{runtime:`picat`,property:`baseUrl`,key:`picatBaseUrl`},{runtime:`parigp`,property:`baseUrl`,key:`parigpBaseUrl`},{runtime:`fortran`,property:`baseUrl`,key:`fortranBaseUrl`},{runtime:`fortran`,property:`f2cWasmUrl`,key:`fortranF2cWasmUrl`},{runtime:`fortran`,property:`libf2cUrl`,key:`fortranLibf2cUrl`},{runtime:`fortran`,property:`f2cHeaderUrl`,key:`fortranF2cHeaderUrl`},{runtime:`fortran`,property:`analyzerUrl`,key:`fortranAnalyzerUrl`},{runtime:`fortran`,property:`integrity`,key:`fortranIntegrity`,serialize:G},{runtime:`zig`,property:`compilerUrl`,key:`zigCompilerUrl`},{runtime:`zig`,property:`stdlibUrl`,key:`zigStdlibUrl`},{runtime:`zig`,property:`integrity`,key:`zigIntegrity`,serialize:G},{runtime:`objectivec`,property:`baseUrl`,key:`objectiveCBaseUrl`},{runtime:`objectivec`,property:`libobjcUrl`,key:`objectiveCLibobjcUrl`},{runtime:`objectivec`,property:`headersUrl`,key:`objectiveCHeadersUrl`},{runtime:`objectivec`,property:`libgnustepBaseUrl`,key:`objectiveCLibgnustepBaseUrl`},{runtime:`objectivec`,property:`libgnustepBaseObjectUrl`,key:`objectiveCLibgnustepBaseObjectUrl`},{runtime:`objectivec`,property:`foundationHeadersUrl`,key:`objectiveCFoundationHeadersUrl`},{runtime:`objectivec`,property:`libffiUrl`,key:`objectiveCLibffiUrl`},{runtime:`objectivec`,property:`integrity`,key:`objectiveCIntegrity`,serialize:G},{runtime:`lisp`,property:`moduleUrl`,key:`lispModuleUrl`},{runtime:`lisp`,property:`manifestUrl`,key:`lispManifestUrl`},{runtime:`lisp`,property:`manifestFingerprint`,key:`lispManifestFingerprint`},{runtime:`lisp`,property:`manifestReceipt`,key:`lispManifestReceipt`,serialize:K},{runtime:`ruby`,property:`baseUrl`,key:`rubyBaseUrl`},{runtime:`ruby`,property:`manifestUrl`,key:`rubyManifestUrl`},{runtime:`ruby`,property:`moduleUrl`,key:`rubyModuleUrl`},{runtime:`ruby`,property:`wasmUrl`,key:`rubyWasmUrl`},{runtime:`ruby`,property:`splitStdlib`,key:`rubySplitStdlib`,serialize:e=>e===!0},{runtime:`ruby`,property:`profileId`,key:`rubyProfileId`},{runtime:`ruby`,property:`artifactRevision`,key:`rubyArtifactRevision`},{runtime:`ruby`,property:`rubyVersion`,key:`rubyVersion`},{runtime:`ruby`,property:`rubyRevision`,key:`rubyRevision`},{runtime:`ruby`,property:`rubyWasmVersion`,key:`rubyWasmVersion`},{runtime:`ruby`,property:`rubyWasmRevision`,key:`rubyWasmRevision`},{runtime:`ruby`,property:`wasiSdkVersion`,key:`rubyWasiSdkVersion`},{runtime:`ruby`,property:`manifestFingerprint`,key:`rubyManifestFingerprint`},{runtime:`ruby`,property:`manifestReceipt`,key:`rubyManifestReceipt`,serialize:K},{runtime:`ruby`,property:`moduleJavaScriptReceipt`,key:`rubyModuleJavaScriptReceipt`,serialize:K},{runtime:`ruby`,property:`wasmReceipt`,key:`rubyWasmReceipt`,serialize:K},{runtime:`r`,property:`baseUrl`,key:`rBaseUrl`},{runtime:`octave`,property:`baseUrl`,key:`octaveBaseUrl`},{runtime:`octave`,property:`workerUrl`,key:`octaveWorkerUrl`},{runtime:`octave`,property:`manifestUrl`,key:`octaveManifestUrl`},{runtime:`prolog`,property:`baseUrl`,key:`prologBaseUrl`},{runtime:`prolog`,property:`workerUrl`,key:`prologWorkerUrl`},{runtime:`prolog`,property:`manifestUrl`,key:`prologManifestUrl`},{runtime:`prolog`,property:`manifestFingerprint`,key:`prologManifestFingerprint`},{runtime:`prolog`,property:`profileId`,key:`prologProfileId`},{runtime:`prolog`,property:`packageRevision`,key:`prologPackageRevision`},{runtime:`prolog`,property:`swiplRevision`,key:`prologSwiplRevision`},{runtime:`prolog`,property:`manifestReceipt`,key:`prologManifestReceipt`,serialize:K},{runtime:`prolog`,property:`javascriptReceipt`,key:`prologJavaScriptReceipt`,serialize:K},{runtime:`prolog`,property:`wasmReceipt`,key:`prologWasmReceipt`,serialize:K},{runtime:`prolog`,property:`dataReceipt`,key:`prologDataReceipt`,serialize:K},{runtime:`prolog`,property:`workerReceipt`,key:`prologWorkerReceipt`,serialize:K},{runtime:`gleam`,property:`baseUrl`,key:`gleamBaseUrl`},{runtime:`gleam`,property:`workerUrl`,key:`gleamWorkerUrl`},{runtime:`gleam`,property:`manifestUrl`,key:`gleamManifestUrl`},{runtime:`gleam`,property:`manifestFingerprint`,key:`gleamManifestFingerprint`},{runtime:`gleam`,property:`workerReceipt`,key:`gleamWorkerReceipt`,serialize:K},{runtime:`perl`,property:`baseUrl`,key:`perlBaseUrl`},{runtime:`perl`,property:`workerUrl`,key:`perlWorkerUrl`},{runtime:`perl`,property:`manifestUrl`,key:`perlManifestUrl`},{runtime:`perl`,property:`manifestFingerprint`,key:`perlManifestFingerprint`},{runtime:`perl`,property:`profileId`,key:`perlProfileId`},{runtime:`perl`,property:`artifactRevision`,key:`perlArtifactRevision`},{runtime:`perl`,property:`webperlRevision`,key:`perlWebperlRevision`},{runtime:`perl`,property:`perlRevision`,key:`perlPerlRevision`},{runtime:`perl`,property:`emscriptenRevision`,key:`perlEmscriptenRevision`},{runtime:`perl`,property:`manifestReceipt`,key:`perlManifestReceipt`,serialize:K},{runtime:`perl`,property:`javascriptReceipt`,key:`perlJavaScriptReceipt`,serialize:K},{runtime:`perl`,property:`wasmReceipt`,key:`perlWasmReceipt`,serialize:K},{runtime:`perl`,property:`dataReceipt`,key:`perlDataReceipt`,serialize:K},{runtime:`perl`,property:`workerReceipt`,key:`perlWorkerReceipt`,serialize:K},{runtime:`tcl`,property:`baseUrl`,key:`tclBaseUrl`},{runtime:`tcl`,property:`workerUrl`,key:`tclWorkerUrl`},{runtime:`tcl`,property:`manifestUrl`,key:`tclManifestUrl`},{runtime:`tcl`,property:`manifestFingerprint`,key:`tclManifestFingerprint`},{runtime:`tcl`,property:`profileId`,key:`tclProfileId`},{runtime:`tcl`,property:`artifactRevision`,key:`tclArtifactRevision`},{runtime:`tcl`,property:`waclRevision`,key:`tclWaclRevision`},{runtime:`tcl`,property:`tclRevision`,key:`tclTclRevision`},{runtime:`tcl`,property:`requireJsRevision`,key:`tclRequireJsRevision`},{runtime:`tcl`,property:`emscriptenRevision`,key:`tclEmscriptenRevision`},{runtime:`tcl`,property:`manifestReceipt`,key:`tclManifestReceipt`,serialize:K},{runtime:`tcl`,property:`requireJsReceipt`,key:`tclRequireJsReceipt`,serialize:K},{runtime:`tcl`,property:`customDataReceipt`,key:`tclCustomDataReceipt`,serialize:K},{runtime:`tcl`,property:`libraryDataReceipt`,key:`tclLibraryDataReceipt`,serialize:K},{runtime:`tcl`,property:`glueReceipt`,key:`tclGlueReceipt`,serialize:K},{runtime:`tcl`,property:`wasmReceipt`,key:`tclWasmReceipt`,serialize:K},{runtime:`tcl`,property:`workerReceipt`,key:`tclWorkerReceipt`,serialize:K},{runtime:`awk`,property:`baseUrl`,key:`awkBaseUrl`},{runtime:`awk`,property:`workerUrl`,key:`awkWorkerUrl`},{runtime:`awk`,property:`manifestUrl`,key:`awkManifestUrl`},{runtime:`awk`,property:`manifestFingerprint`,key:`awkManifestFingerprint`},{runtime:`awk`,property:`profileId`,key:`awkProfileId`},{runtime:`awk`,property:`goVersion`,key:`awkGoVersion`},{runtime:`awk`,property:`goawkVersion`,key:`awkGoawkVersion`},{runtime:`awk`,property:`manifestReceipt`,key:`awkManifestReceipt`,serialize:K},{runtime:`awk`,property:`workerReceipt`,key:`awkWorkerReceipt`,serialize:K},{runtime:`awk`,property:`goShimReceipt`,key:`awkGoShimReceipt`,serialize:K},{runtime:`awk`,property:`wasmReceipt`,key:`awkWasmReceipt`,serialize:K},{runtime:`pascal`,property:`baseUrl`,key:`pascalBaseUrl`},{runtime:`pascal`,property:`workerUrl`,key:`pascalWorkerUrl`},{runtime:`pascal`,property:`manifestUrl`,key:`pascalManifestUrl`},{runtime:`pascal`,property:`compilerJavaScriptUrl`,key:`pascalCompilerJavaScriptUrl`},{runtime:`pascal`,property:`rtlJavaScriptUrl`,key:`pascalRtlJavaScriptUrl`},{runtime:`pascal`,property:`systemPascalUrl`,key:`pascalSystemPascalUrl`},{runtime:`pascal`,property:`manifestFingerprint`,key:`pascalManifestFingerprint`},{runtime:`pascal`,property:`profileId`,key:`pascalProfileId`},{runtime:`pascal`,property:`artifactRevision`,key:`pascalArtifactRevision`},{runtime:`pascal`,property:`pas2jsVersion`,key:`pascalPas2jsVersion`},{runtime:`pascal`,property:`pas2jsRevision`,key:`pascalPas2jsRevision`},{runtime:`pascal`,property:`manifestReceipt`,key:`pascalManifestReceipt`,serialize:K},{runtime:`pascal`,property:`compilerJavaScriptReceipt`,key:`pascalCompilerJavaScriptReceipt`,serialize:K},{runtime:`pascal`,property:`rtlJavaScriptReceipt`,key:`pascalRtlJavaScriptReceipt`,serialize:K},{runtime:`pascal`,property:`systemPascalReceipt`,key:`pascalSystemPascalReceipt`,serialize:K},{runtime:`pascal`,property:`workerReceipt`,key:`pascalWorkerReceipt`,serialize:K},{runtime:`forth`,property:`baseUrl`,key:`forthBaseUrl`},{runtime:`forth`,property:`workerUrl`,key:`forthWorkerUrl`},{runtime:`forth`,property:`manifestUrl`,key:`forthManifestUrl`},{runtime:`forth`,property:`manifestFingerprint`,key:`forthManifestFingerprint`},{runtime:`forth`,property:`profileId`,key:`forthProfileId`},{runtime:`forth`,property:`implementationVersion`,key:`forthImplementationVersion`},{runtime:`forth`,property:`manifestReceipt`,key:`forthManifestReceipt`,serialize:K},{runtime:`forth`,property:`runtimeReceipt`,key:`forthRuntimeReceipt`,serialize:K},{runtime:`forth`,property:`workerReceipt`,key:`forthWorkerReceipt`,serialize:K},{runtime:`j`,property:`baseUrl`,key:`jBaseUrl`},{runtime:`j`,property:`workerUrl`,key:`jWorkerUrl`},{runtime:`j`,property:`manifestUrl`,key:`jManifestUrl`},{runtime:`j`,property:`manifestFingerprint`,key:`jManifestFingerprint`},{runtime:`j`,property:`profileId`,key:`jProfileId`},{runtime:`j`,property:`sourceRevision`,key:`jSourceRevision`},{runtime:`j`,property:`manifestReceipt`,key:`jManifestReceipt`,serialize:K},{runtime:`j`,property:`moduleReceipt`,key:`jModuleReceipt`,serialize:K},{runtime:`j`,property:`wasmReceipt`,key:`jWasmReceipt`,serialize:K},{runtime:`j`,property:`workerReceipt`,key:`jWorkerReceipt`,serialize:K},{runtime:`bqn`,property:`baseUrl`,key:`bqnBaseUrl`},{runtime:`bqn`,property:`workerUrl`,key:`bqnWorkerUrl`},{runtime:`bqn`,property:`manifestUrl`,key:`bqnManifestUrl`},{runtime:`bqn`,property:`manifestFingerprint`,key:`bqnManifestFingerprint`},{runtime:`bqn`,property:`profileId`,key:`bqnProfileId`},{runtime:`bqn`,property:`sourceRevision`,key:`bqnSourceRevision`},{runtime:`bqn`,property:`manifestReceipt`,key:`bqnManifestReceipt`,serialize:K},{runtime:`bqn`,property:`moduleReceipt`,key:`bqnModuleReceipt`,serialize:K},{runtime:`bqn`,property:`wasmReceipt`,key:`bqnWasmReceipt`,serialize:K},{runtime:`bqn`,property:`workerReceipt`,key:`bqnWorkerReceipt`,serialize:K},{runtime:`janet`,property:`baseUrl`,key:`janetBaseUrl`},{runtime:`janet`,property:`workerUrl`,key:`janetWorkerUrl`},{runtime:`janet`,property:`manifestUrl`,key:`janetManifestUrl`},{runtime:`janet`,property:`manifestFingerprint`,key:`janetManifestFingerprint`},{runtime:`janet`,property:`profileId`,key:`janetProfileId`},{runtime:`janet`,property:`artifactRevision`,key:`janetArtifactRevision`},{runtime:`janet`,property:`janetVersion`,key:`janetJanetVersion`},{runtime:`janet`,property:`emscriptenVersion`,key:`janetEmscriptenVersion`},{runtime:`janet`,property:`manifestReceipt`,key:`janetManifestReceipt`,serialize:K},{runtime:`janet`,property:`javascriptReceipt`,key:`janetJavaScriptReceipt`,serialize:K},{runtime:`janet`,property:`wasmReceipt`,key:`janetWasmReceipt`,serialize:K},{runtime:`janet`,property:`workerReceipt`,key:`janetWorkerReceipt`,serialize:K},{runtime:`julia`,property:`baseUrl`,key:`juliaBaseUrl`},{runtime:`julia`,property:`workerUrl`,key:`juliaWorkerUrl`},{runtime:`julia`,property:`manifestUrl`,key:`juliaManifestUrl`},{runtime:`julia`,property:`manifestFingerprint`,key:`juliaManifestFingerprint`},{runtime:`julia`,property:`profileId`,key:`juliaProfileId`},{runtime:`julia`,property:`packageRevision`,key:`juliaPackageRevision`},{runtime:`julia`,property:`importedByCommit`,key:`juliaImportedByCommit`},{runtime:`julia`,property:`juliaVersion`,key:`juliaJuliaVersion`},{runtime:`julia`,property:`emscriptenVersion`,key:`juliaEmscriptenVersion`},{runtime:`julia`,property:`manifestReceipt`,key:`juliaManifestReceipt`,serialize:K},{runtime:`julia`,property:`javascriptReceipt`,key:`juliaJavaScriptReceipt`,serialize:K},{runtime:`julia`,property:`wasmReceipt`,key:`juliaWasmReceipt`,serialize:K},{runtime:`julia`,property:`dataReceipt`,key:`juliaDataReceipt`,serialize:K},{runtime:`julia`,property:`workerReceipt`,key:`juliaWorkerReceipt`,serialize:K},{runtime:`c3`,property:`baseUrl`,key:`c3BaseUrl`},{runtime:`grain`,property:`baseUrl`,key:`grainBaseUrl`},{runtime:`scala`,property:`baseUrl`,key:`scalaBaseUrl`},{runtime:`hy`,property:`baseUrl`,key:`hyBaseUrl`},{runtime:`aheui`,property:`baseUrl`,key:`aheuiBaseUrl`},{runtime:`apecode`,property:`baseUrl`,key:`apecodeBaseUrl`},{runtime:`golfscript`,property:`interpreterUrl`,key:`golfscriptInterpreterUrl`},{runtime:`nim`,property:`baseUrl`,key:`nimBaseUrl`},{runtime:`nim`,property:`workerUrl`,key:`nimWorkerUrl`},{runtime:`nim`,property:`manifestUrl`,key:`nimManifestUrl`},{runtime:`nim`,property:`manifestFingerprint`,key:`nimManifestFingerprint`},{runtime:`nim`,property:`profileId`,key:`nimProfileId`},{runtime:`nim`,property:`artifactRevision`,key:`nimArtifactRevision`},{runtime:`nim`,property:`nimRevision`,key:`nimNimRevision`},{runtime:`nim`,property:`llvmRevision`,key:`nimLlvmRevision`},{runtime:`nim`,property:`memfsRevision`,key:`nimMemfsRevision`},{runtime:`nim`,property:`emscriptenRevision`,key:`nimEmscriptenRevision`},{runtime:`nim`,property:`manifestReceipt`,key:`nimManifestReceipt`,serialize:K},{runtime:`nim`,property:`nimJavaScriptReceipt`,key:`nimJavaScriptReceipt`,serialize:K},{runtime:`nim`,property:`nimWasmReceipt`,key:`nimWasmReceipt`,serialize:K},{runtime:`nim`,property:`nimbaseReceipt`,key:`nimNimbaseReceipt`,serialize:K},{runtime:`nim`,property:`clangJavaScriptReceipt`,key:`nimClangJavaScriptReceipt`,serialize:K},{runtime:`nim`,property:`clangWasmReceipt`,key:`nimClangWasmReceipt`,serialize:K},{runtime:`nim`,property:`lldWasmReceipt`,key:`nimLldWasmReceipt`,serialize:K},{runtime:`nim`,property:`memfsWasmReceipt`,key:`nimMemfsWasmReceipt`,serialize:K},{runtime:`nim`,property:`sysrootReceipt`,key:`nimSysrootReceipt`,serialize:K},{runtime:`nim`,property:`workerReceipt`,key:`nimWorkerReceipt`,serialize:K},{runtime:`bash`,property:`baseUrl`,key:`bashBaseUrl`},{runtime:`bash`,property:`manifestUrl`,key:`bashManifestUrl`},{runtime:`bash`,property:`moduleUrl`,key:`bashModuleUrl`},{runtime:`bash`,property:`wasmerWasmUrl`,key:`bashWasmerWasmUrl`},{runtime:`bash`,property:`webcUrl`,key:`bashWebcUrl`},{runtime:`bash`,property:`workerUrl`,key:`bashWorkerUrl`},{runtime:`bash`,property:`manifestFingerprint`,key:`bashManifestFingerprint`},{runtime:`bash`,property:`profileId`,key:`bashProfileId`},{runtime:`bash`,property:`bashPackageVersion`,key:`bashPackageVersion`},{runtime:`bash`,property:`bashSourceRevision`,key:`bashSourceRevision`},{runtime:`bash`,property:`wasmerSdkVersion`,key:`bashWasmerSdkVersion`},{runtime:`bash`,property:`wasmerSdkPackageIntegrity`,key:`bashWasmerSdkPackageIntegrity`},{runtime:`bash`,property:`manifestReceipt`,key:`bashManifestReceipt`,serialize:K},{runtime:`bash`,property:`sdkJavaScriptReceipt`,key:`bashSdkJavaScriptReceipt`,serialize:K},{runtime:`bash`,property:`wasmerWasmReceipt`,key:`bashWasmerWasmReceipt`,serialize:K},{runtime:`bash`,property:`webcReceipt`,key:`bashWebcReceipt`,serialize:K},{runtime:`clojurescript`,property:`baseUrl`,key:`clojurescriptBaseUrl`},{runtime:`clojurescript`,property:`workerUrl`,key:`clojurescriptWorkerUrl`},{runtime:`clojurescript`,property:`manifestUrl`,key:`clojurescriptManifestUrl`},{runtime:`clojurescript`,property:`manifestFingerprint`,key:`clojurescriptManifestFingerprint`},{runtime:`clojurescript`,property:`profileId`,key:`clojurescriptProfileId`},{runtime:`clojurescript`,property:`sourceRevision`,key:`clojurescriptSourceRevision`},{runtime:`clojurescript`,property:`integrationRevision`,key:`clojurescriptIntegrationRevision`},{runtime:`clojurescript`,property:`manifestReceipt`,key:`clojurescriptManifestReceipt`,serialize:K},{runtime:`clojurescript`,property:`compilerReceipt`,key:`clojurescriptCompilerReceipt`,serialize:K},{runtime:`clojurescript`,property:`workerReceipt`,key:`clojurescriptWorkerReceipt`,serialize:K},{runtime:`rescript`,property:`baseUrl`,key:`rescriptBaseUrl`},{runtime:`rescript`,property:`workerUrl`,key:`rescriptWorkerUrl`},{runtime:`rescript`,property:`manifestUrl`,key:`rescriptManifestUrl`},{runtime:`rescript`,property:`manifestFingerprint`,key:`rescriptManifestFingerprint`},{runtime:`rescript`,property:`profileId`,key:`rescriptProfileId`},{runtime:`rescript`,property:`sourceRevision`,key:`rescriptSourceRevision`},{runtime:`rescript`,property:`manifestReceipt`,key:`rescriptManifestReceipt`,serialize:K},{runtime:`rescript`,property:`compilerReceipt`,key:`rescriptCompilerReceipt`,serialize:K},{runtime:`rescript`,property:`workerReceipt`,key:`rescriptWorkerReceipt`,serialize:K},{runtime:`cobol`,property:`baseUrl`,key:`cobolBaseUrl`},{runtime:`v`,property:`baseUrl`,key:`vBaseUrl`},{runtime:`swift`,property:`baseUrl`,key:`swiftBaseUrl`},{runtime:`swift`,property:`workerUrl`,key:`swiftWorkerUrl`},{runtime:`swift`,property:`manifestUrl`,key:`swiftManifestUrl`},{runtime:`postgresql`,property:`moduleUrl`,key:`postgresqlModuleUrl`},{runtime:`graphql`,property:`workerUrl`,key:`graphqlWorkerUrl`},{runtime:`graphql`,property:`workerReceipt`,key:`graphqlWorkerReceipt`,serialize:K},{runtime:`sqlite`,property:`moduleUrl`,key:`sqliteModuleUrl`},{runtime:`sqlite`,property:`wasmUrl`,key:`sqliteWasmUrl`},{runtime:`php`,property:`moduleUrl`,key:`phpModuleUrl`}],ot=(e,t)=>e[t],st=(e,t)=>{let n=ot(e,t.runtime)?.[t.property];return t.serialize?t.serialize(n):typeof n==`string`?n:``};function ct(e){if(typeof e==`string`)return e;if(!e)return;let t={rootUrl:e.rootUrl||``};e.persistentCache!==void 0&&(t.persistentCache=et(e.persistentCache));let n=[];for(let[t,r]of Object.entries(e.runtimeProfiles||{}).sort(([e],[t])=>e.localeCompare(t))){if(!t.trim()||!r||typeof r!=`object`)throw TypeError(`Runtime profile entries require a non-empty runtime ID and profile`);if(typeof r.profileId!=`string`||!r.profileId.trim())throw TypeError(`Runtime profile ${t} requires a non-empty profile ID`);if(!Number.isSafeInteger(r.manifestSchemaVersion)||r.manifestSchemaVersion<1)throw TypeError(`Runtime profile ${t} has an invalid manifest schema version`);if(typeof r.manifestSha256!=`string`||!/^[a-f0-9]{64}$/u.test(r.manifestSha256))throw TypeError(`Runtime profile ${t} has an invalid manifest SHA-256`);if(!Number.isSafeInteger(r.protocolVersion)||r.protocolVersion<1)throw TypeError(`Runtime profile ${t} has an invalid protocol version`);let e=r.trustProfileId!==void 0,i=r.trustProfileSchemaVersion!==void 0;if(e!==i)throw TypeError(`Runtime profile ${t} requires both trust profile ID and schema version`);if(e&&(typeof r.trustProfileId!=`string`||!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(r.trustProfileId)))throw TypeError(`Runtime profile ${t} has an invalid trust profile ID`);if(i&&(!Number.isSafeInteger(r.trustProfileSchemaVersion)||(r.trustProfileSchemaVersion??0)<1))throw TypeError(`Runtime profile ${t} has an invalid trust profile schema version`);n.push([t,{profileId:r.profileId,manifestSchemaVersion:r.manifestSchemaVersion,manifestSha256:r.manifestSha256,protocolVersion:r.protocolVersion,trustProfileId:r.trustProfileId,trustProfileSchemaVersion:r.trustProfileSchemaVersion}])}t.runtimeProfiles=JSON.stringify(n);for(let n of at)t[n.key]=st(e,n);for(let n of it){let r=ot(e,n.runtime),i=r?.[n.loaderProperty],a=``;if(typeof i==`object`&&i||typeof i==`function`){let e=r?.[n.loaderKeyProperty],t=typeof e==`string`?e:``;t?a=`key:${t}`:(a=nt.get(i)||``,a||(a=`instance:${++rt}`,nt.set(i,a)))}t[n.identityKey]=a}return JSON.stringify(t)}function lt(){return{canStart(){if(typeof window>`u`||typeof document>`u`)return!1;let e=navigator.connection;return document.visibilityState!==`hidden`&&e?.saveData!==!0&&![`slow-2g`,`2g`].includes(e?.effectiveType??``)},schedule(e){if(typeof window.requestIdleCallback==`function`){let t=window.requestIdleCallback(e,{timeout:1500});return()=>window.cancelIdleCallback(t)}let t=setTimeout(e,250);return()=>clearTimeout(t)}}}function ut(e,t={}){let n=t.enabled===!0,r=!1,i,a=t.environment??lt(),o=/* @__PURE__ */ new Set,s=async e=>{t.release?await t.release(e):e.dispose?await e.dispose():await e.terminate()},c=()=>{let e=i;if(i=void 0,!e)return Promise.resolve();e.cancelSchedule(),e.controller.abort(new DOMException(`Runtime prewarm cancelled`,`AbortError`)),e.start();let t=e.result.then(async e=>{e&&await s(e)});return o.add(t),t.finally(()=>o.delete(t)).catch(()=>{}),t};return{get enabled(){return n},async setEnabled(e){if(typeof e!=`boolean`)throw TypeError(`prewarm must be a boolean`);n=e,n||await c()},warm(t){if(r||!n||!a.canStart())return Promise.resolve(!1);if(i?.key===t){let e=i;return e.result.then(t=>!(!t||e.controller.signal.aborted||!e.taken&&i!==e))}let o=c().catch(()=>{}),s=new AbortController,l,u=new Promise(e=>{l=e}),d={key:t,controller:s,result:u,taken:!1,started:!1,cancelSchedule:()=>{},start(){d.started||(d.started=!0,d.cancelSchedule(),o.then(()=>{if(s.signal.aborted||r||!d.taken&&!a.canStart()){l(void 0);return}Promise.resolve().then(()=>e(t,s.signal)).then(l,()=>l(void 0))}))}};return i=d,d.cancelSchedule=a.schedule(d.start),u.then(e=>{!e&&i===d&&(i=void 0)}),u.then(e=>!(!e||s.signal.aborted||!d.taken&&i!==d))},take(e){let t=i;if(t&&!r){if(t.key!==e){c().catch(()=>{});return}return i=void 0,t.taken=!0,t.start(),t.result}},cancel:c,async dispose(){r||(r=!0,await c(),await Promise.allSettled([...o]))}}}const dt=new TextEncoder,ft=1e3;function pt(e){let t={...e},n=t;for(let e of[`args`,`compileArgs`,`programArgs`,`breakpoints`]){let t=n[e];Array.isArray(t)&&(n[e]=t.slice())}if(n.debugSteppingOptions&&={...n.debugSteppingOptions},n.env&&typeof n.env==`object`&&!Array.isArray(n.env)&&(n.env={...n.env}),n.sourceBreakpoints&&=n.sourceBreakpoints.map(e=>({...e,lines:e.lines.slice(),...e.breakpoints?{breakpoints:e.breakpoints.map(e=>({...e}))}:{}})),n.debug&&typeof n.debug==`object`&&!Array.isArray(n.debug)){let e=n.debug;n.debug={...e,...e.steppingOptions?{steppingOptions:{...e.steppingOptions}}:{},sourceBreakpoints:e.sourceBreakpoints?.map(e=>({...e,lines:e.lines.slice(),...e.breakpoints?{breakpoints:e.breakpoints.map(e=>({...e}))}:{}}))}}return t}function mt(e,t,n=`execute`,r,i){if(t.signal?.aborted)throw new u(`Runtime operation was cancelled before it started`,{cause:t.signal.reason,phase:n});if(t.interactive!==void 0&&typeof t.interactive!=`boolean`)throw new m(`Interactive execution must be a boolean`,{phase:n});let a=c({...i,...t.limits}),s={...t.workspaceLimits,maxFileBytes:Math.min(t.workspaceLimits?.maxFileBytes??o.maxFileBytes,a.maxWorkspaceBytes),maxTotalBytes:Math.min(t.workspaceLimits?.maxTotalBytes??o.maxTotalBytes,a.maxWorkspaceBytes)},{activePath:l,workspaceFiles:d}=f(e,t.workspaceFiles??[],t.activePath,s),p=t.runtimeRequirements;if(p!==void 0&&!r)throw new m(`Runtime requirements cannot be admitted without a trust profile`,{phase:n});let h=p?.wasmMemoryBytes??0;if(!Number.isSafeInteger(h)||h<0)throw new m(`Runtime Wasm memory request must be a non-negative safe integer`,{phase:n});if(h>a.maxWasmMemoryBytes)throw new m(`Runtime requested ${h} Wasm memory bytes; execution limit is ${a.maxWasmMemoryBytes}`,{phase:n});let g=r?We(r,{environment:t.env,networkUrls:p?.networkUrls,pageOrigin:p?.pageOrigin,storage:p?.storage,threads:p?.threads,nestedWorkers:p?.nestedWorkers,sharedArrayBuffer:p?.sharedArrayBuffer,dynamicCode:p?.dynamicCode,sameOriginAccess:p?.sameOriginAccess}):void 0;if(g&&g.threads>a.maxThreads)throw new m(`Runtime requested ${g.threads} threads; execution limit is ${a.maxThreads}`,{phase:n});if(g&&g.nestedWorkers>a.maxWorkers)throw new m(`Runtime requested ${g.nestedWorkers} nested workers; execution limit is ${a.maxWorkers}`,{phase:n});let _=p&&g?Object.freeze({wasmMemoryBytes:h,networkUrls:g.networkUrls,...g.pageOrigin===void 0?{}:{pageOrigin:g.pageOrigin},storage:g.storage,threads:g.threads,nestedWorkers:g.nestedWorkers,sharedArrayBuffer:g.sharedArrayBuffer,dynamicCode:g.dynamicCode,sameOriginAccess:g.sameOriginAccess}):void 0,v=g?.environment??t.env;return{...t,limits:a,...t.workspaceLimits===void 0&&t.limits?.maxWorkspaceBytes===void 0?{}:{workspaceLimits:s},...t.activePath===void 0?{}:{activePath:l},...t.workspaceFiles===void 0?{}:{workspaceFiles:d},...t.env===void 0?{}:{env:v},..._===void 0?{}:{runtimeRequirements:_}}}function ht(e,t,n,i,a,o,s,c,l){if(t.active)return Promise.reject(new r(`A sandbox operation is already active`,{phase:s}));t.active=!0,t.acceptOutput=!0;let d=++t.generation;return l(d),t.outputBytes=0,t.diagnosticCount=0,t.maxOutputBytes=o.maxOutputBytes,t.maxDiagnostics=o.maxDiagnostics,t.phase=s,t.limitExceeded=!1,new Promise((r,o)=>{let l=!1,f=!1,m=!1,h,g,_,v,y,b,x=()=>{y!==void 0&&clearTimeout(y),i?.removeEventListener(`abort`,T),t.onLimit=void 0,t.onDispose=void 0},S=t=>{if(m)return g;m=!0,g=new Promise((e,t)=>{_=e,v=t}),g.catch(()=>void 0),b=setTimeout(()=>{c(),v?.(new p(`Sandbox cancellation did not settle within 1000 ms`,{phase:`dispose`,timeoutMs:ft}))},ft);try{let n=t?t():e.cancel?e.cancel():e.kill?e.kill():e.terminate();h=Promise.resolve(n).then(()=>void 0,e=>{c(),v?.(e)})}catch(e){c(),v?.(e),h=Promise.resolve()}return g},C=()=>{b!==void 0&&clearTimeout(b),_?.(),t.generation===d&&(t.active=!1,t.acceptOutput=!1,t.outputBytes=0,t.diagnosticCount=0,t.limitExceeded=!1,t.onLimit=void 0,t.onDispose=void 0,t.onCancel=void 0)},w=e=>{l||(l=!0,t.acceptOutput=!1,x(),e())},T=()=>{w(()=>o(new u(`Runtime operation cancelled`,{cause:i?.reason,phase:s}))),f?S():C()};if(t.onLimit=e=>{w(()=>o(e)),f?S():C()},t.onCancel=e=>{w(()=>o(new u(`Runtime operation cancelled`,{phase:s})));let t=S(e);return f||h.then(C),t},t.onDispose=()=>{f||C(),w(()=>o(new u(`Runtime operation cancelled because its sandbox was disposed`,{phase:`dispose`})))},i?.addEventListener(`abort`,T,{once:!0}),i?.aborted){T();return}a!==null&&(y=setTimeout(()=>{w(()=>o(new p(`Runtime ${s} exceeded ${a} ms`,{phase:s,timeoutMs:a}))),f?S():C()},a)),Promise.resolve().then(async()=>{if(l){m||C();return}f=!0;try{let e=await n();h&&await h,C(),w(()=>r(e))}catch(e){h&&await h,C(),w(()=>o(e))}})})}function gt(...e){return e.reduce((e,t)=>Math.min(2147483647,e+t),0)}function _t(e,t,n,o,s){let c=e=>{if(o===void 0&&e===void 0)return;let t={};for(let n of[o,e])n===!1?t.enabled=!1:n&&Object.assign(t,Object.fromEntries(Object.entries(n).filter(([,e])=>e!==void 0)));return V(t),t},l=Object.freeze({...e.defaultExecutionLimits}),u,f=!1,h={active:!1,acceptOutput:!1,generation:0,outputBytes:0,diagnosticCount:0,maxOutputBytes:0,maxDiagnostics:0,phase:`execute`,limitExceeded:!1},g=e.output,_=e.oncompilerdiagnostic,v=(e,t)=>{if(f||!h.acceptOutput||h.generation!==e||h.limitExceeded)return;let n=h.outputBytes+dt.encode(t).byteLength;if(n>h.maxOutputBytes){h.outputBytes=n,h.limitExceeded=!0,h.onLimit?.(new i(`Runtime output exceeded ${h.maxOutputBytes} bytes`,{limit:h.maxOutputBytes,actual:n,phase:h.phase}));return}h.outputBytes=n,g?.(t)},y=(e,t)=>{if(f||!h.acceptOutput||h.generation!==e||h.limitExceeded)return;let n=h.diagnosticCount+1;if(n>h.maxDiagnostics){h.diagnosticCount=n,h.limitExceeded=!0,h.onLimit?.(new a(`Runtime diagnostics exceeded ${h.maxDiagnostics} entries`,{limit:h.maxDiagnostics,actual:n,phase:h.phase===`execute`?`compile`:h.phase}));return}h.diagnosticCount=n,_?.(t)},b=(t=h.generation)=>{e.output=e=>v(t,e),e.oncompilerdiagnostic=e=>y(t,e)},x=()=>{if(!u){f=!0,h.acceptOutput=!1,h.onDispose?.(),s?.();let t=Promise.resolve().then(async()=>{e.dispose?await e.dispose():await e.terminate()});u=new Promise((e,n)=>{let r=setTimeout(()=>{n(new p(`Sandbox disposal did not settle within 1000 ms`,{phase:`dispose`,timeoutMs:ft}))},ft);t.then(()=>{clearTimeout(r),e()},e=>{clearTimeout(r),n(e)})})}return u},S=()=>{x().catch(()=>void 0)},C=()=>{if(f)throw new m(`Cannot use a disposed sandbox`,{phase:`dispose`})};return b(),new Proxy(e,{get(e,i,a){if(i===`runtimeAssets`)return t;if(i===`trustProfile`)return n;if(i===`output`)return g;if(i===`oncompilerdiagnostic`)return _;if(i===`dispose`)return x;if(i===`cancel`||i===`kill`||i===`terminate`){let t=e[i];if(t)return n=>{if(f)return u;let r=()=>t.call(e,n);return n===void 0&&h.onCancel?h.onCancel(r):r()}}if(i===`restart`)return async()=>{if(C(),h.active)throw new r(`Cannot restart a runtime while an operation is active`,{phase:h.phase});b(),e.restart?await e.restart():await e.clear()};if(i===`load`)return async(r=``,i=!0,a=[],o={},s)=>{C();let u=a.slice(),d=pt(o),f=mt(r,{...d,persistentCache:c(d.persistentCache)},`startup`,n,l);return ht(e,h,()=>e.load(t,r,i,u,f,s),f.signal,gt(f.limits.assetTimeoutMs,f.limits.startupTimeoutMs),f.limits,`startup`,S,b)};let o=e.execute;if(i===`execute`&&o)return async t=>{C();let r=pt(t),i=mt(r.code,{activePath:r.activePath,persistentCache:c(r.persistentCache),workspaceFiles:r.workspaceFiles,args:r.args,compileArgs:r.compileArgs,debug:r.debug,env:r.env,...r.runtimeRequirements===void 0?{}:{runtimeRequirements:r.runtimeRequirements},limits:r.limits??{},signal:r.signal,stdin:r.stdin},`execute`,n,l);return ht(e,h,async()=>{let t=await o.call(e,{...r,env:i.env,persistentCache:i.persistentCache,activePath:i.activePath,workspaceFiles:i.workspaceFiles,...i.runtimeRequirements===void 0?{}:{runtimeRequirements:i.runtimeRequirements},limits:i.limits});return d(t,i.limits)},i.signal,gt(i.limits.compileTimeoutMs,i.limits.runTimeoutMs),i.limits,`execute`,S,b)};if(i===`run`)return async(t,r,i,a,o,s={})=>{C();let u=o?.slice(),d=pt(s),f=mt(t,{...d,persistentCache:c(d.persistentCache)},`execute`,n,l);return ht(e,h,()=>e.run(t,r,i,a,u,f),f.signal,r?gt(f.limits.assetTimeoutMs,f.limits.startupTimeoutMs,f.limits.compileTimeoutMs):f.interactive===!0?null:gt(f.limits.compileTimeoutMs,f.limits.runTimeoutMs),f.limits,`execute`,S,b)};let s=Reflect.get(e,i,a);return typeof s==`function`?s.bind(e):s},set(e,t,n,r){return t===`output`?(g=typeof n==`function`?n:void 0,b(),!0):t===`oncompilerdiagnostic`?(_=typeof n==`function`?n:void 0,b(),!0):Reflect.set(e,t,n,r)}})}function vt(t,n,r={}){if(r.prewarm!==void 0&&typeof r.prewarm!=`boolean`)throw TypeError(`prewarm must be a boolean`);let i=r.trustProfile?He(r.trustProfile):void 0,a=/* @__PURE__ */ new Set,o=/* @__PURE__ */ new Map,s=/* @__PURE__ */ new WeakMap,c=!1,l,u=t=>{if(c)throw new m(`Cannot load a sandbox from a disposed binding`,{phase:`dispose`});let n=Ye(t);if(!n)throw new e(t);return n},d=async e=>{let l=_t(await n(e),t,i,r.persistentCache,()=>{a.delete(l);let e=s.get(l);if(e===void 0)return;s.delete(l);let t=(o.get(e)??1)-1;t>0?o.set(e,t):o.delete(e)});if(c)throw l.dispose?await l.dispose():await l.terminate(),new m(`Binding was disposed while loading a sandbox`,{phase:`dispose`});return a.add(l),l},f=e=>JSON.stringify([e,ct(t)]),p=/* @__PURE__ */ new Map,h=ut(async(e,t)=>{let[n]=JSON.parse(e),r=await d(n);try{return await r.load(``,!1,[],{signal:t}),r}catch(e){throw a.delete(r),r.dispose?await r.dispose():await r.terminate(),e}},{enabled:r.prewarm,async release(e){a.delete(e),e.dispose?await e.dispose():await e.terminate()}}),g={runtimeAssets:t,trustProfile:i,terminalProps:{},async load(e){let t=u(e),n=f(t);p.set(n,(p.get(n)??0)+1);try{let e=h.take(n),r=e?await e:void 0;u(t);let i=r??await d(t);return s.set(i,n),o.set(n,(o.get(n)??0)+1),i}finally{let e=(p.get(n)??1)-1;e>0?p.set(n,e):p.delete(n)}},prewarm(e){if(!h.enabled)return Promise.resolve(!1);let t=f(u(e));return o.has(t)||p.has(t)?Promise.resolve(!1):h.warm(t)},setPrewarmEnabled:h.setEnabled,cancelPrewarm:h.cancel,dispose(){if(!l){c=!0;let e=[...a];a.clear(),l=Promise.allSettled([h.dispose(),...e.map(e=>e.dispose?e.dispose():e.terminate())]).then(e=>{let t=e.flatMap(e=>e.status===`rejected`?[e.reason]:[]);if(t.length===1)throw t[0];if(t.length>1)throw AggregateError(t,`Playground binding cleanup failed`)})}return l}};return g.terminalProps={playground:g,runtimeAssets:t,trustProfile:i},g}function yt(e){if(!Array.isArray(e))throw TypeError(`breakpoints must be an array.`);if(e.length>1024)throw RangeError(`breakpoints must not exceed 1024 entries.`);return e.map((e,t)=>{if(!e||typeof e!=`object`||Array.isArray(e))throw TypeError(`breakpoints[${t}] must be an object.`);if(!Number.isSafeInteger(e.line)||e.line<1)throw RangeError(`Breakpoint lines must be positive safe integers.`);if(e.enabled!==void 0&&typeof e.enabled!=`boolean`)throw TypeError(`breakpoints[${t}].enabled must be boolean.`);let n={line:e.line};e.enabled!==void 0&&(n.enabled=e.enabled);for(let r of[`condition`,`hitCondition`,`logMessage`]){let i=e[r];if(i!==void 0){if(typeof i!=`string`)throw TypeError(`breakpoints[${t}].${r} must be a string.`);if(i.length>4096)throw RangeError(`breakpoints[${t}].${r} must not exceed 4096 UTF-16 code units.`);if(i.includes(`\0`))throw TypeError(`breakpoints[${t}].${r} must not contain NUL.`);if(r===`hitCondition`&&i&&(!/^[1-9][0-9]*$/u.test(i)||Number(i)>4294967295))throw RangeError(`hitCondition must be a positive decimal count not exceeding 4294967295.`);n[r]=i}}return n})}function bt(e,t){for(let n of e)if(n.enabled!==!1){for(let[e,r]of[[`condition`,`conditionalBreakpoints`],[`hitCondition`,`hitConditionalBreakpoints`],[`logMessage`,`logPoints`]])if(n[e]&&t[r]!==!0)throw Error(`Debugger does not support breakpoint ${e}.`)}}function xt(e){if(!e||typeof e!=`object`||Array.isArray(e)||Object.keys(e).some(e=>e!==`skipLibraryCode`)||typeof e.skipLibraryCode!=`boolean`)throw TypeError(`stepping options must contain only the boolean skipLibraryCode policy.`);return{skipLibraryCode:e.skipLibraryCode}}function St(e,t){if(!Array.isArray(t)||t.some(e=>!Number.isSafeInteger(e)||e<1))throw RangeError(`Breakpoint lines must be positive safe integers.`);let n=yt(e);return yt(t.map(e=>{let t=n.find(t=>t.line===e);return t?{...t,enabled:!0}:{line:e}}))}const Ct=Object.freeze({maxManifestBytes:2097152,maxPackages:128,maxCommands:2048,maxAssets:4096,maxFiles:16384,maxAssetBytes:134217728,maxFileBytes:134217728,maxTotalAssetBytes:536870912,maxTotalFileBytes:536870912,maxPathDepth:32,maxDependencyDepth:32}),wt=/* @__PURE__ */ new WeakSet,Tt=/^[a-f0-9]{64}$/u,Et=/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/u,Dt=new TextEncoder;function q(e){throw new g(`INVALID_DISTRIBUTION`,e)}function Ot(e,t,n){(!e||typeof e!=`object`||Array.isArray(e))&&q(`${n} must be an object`);let r=e;for(let e of Object.keys(r))t.includes(e)||q(`${n} has unsupported field ${e}`);return r}function J(e,t,n=4096){return(typeof e!=`string`||e.length>n||e.includes(`\0`))&&q(`${t} must be a bounded string without NUL`),new TextDecoder().decode(Dt.encode(e))!==e&&q(`${t} is not valid Unicode`),e}function kt(e,t){let n=J(e,t,128);return Et.test(n)||q(`${t} is not a valid identifier`),n}function At(e,t,n){return(!Array.isArray(e)||e.length>t)&&q(`${n} must be an array of at most ${t} entries`),e}function jt(e,t,n){let r=At(e,t,n).map(e=>kt(e,n));return new Set(r).size!==r.length&&q(`${n} contains duplicate entries`),Object.freeze(r)}function Mt(e,t,n){let r=Ot(e,[`sha256`,`bytes`,`mediaType`],n);(typeof r.sha256!=`string`||!Tt.test(r.sha256))&&q(`${n} has invalid SHA-256`),(!Number.isSafeInteger(r.bytes)||r.bytes<0||r.bytes>t)&&q(`${n} exceeds its byte limit or has an invalid size`);let i=J(r.mediaType,`${n}.mediaType`,128);return/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(i)||q(`${n} has invalid MIME type`),Object.freeze({sha256:r.sha256,bytes:r.bytes,mediaType:i})}function Nt(e,t){let n=J(e,t),r;try{r=new URL(n)}catch{q(`${t} must be an absolute HTTP(S) URL`)}return(![`https:`,`http:`].includes(r.protocol)||r.username||r.password||r.hash||r.href!==n)&&q(`${t} must be a canonical uncredentialed HTTP(S) URL without a fragment`),n}function Pt(e,t,n){let r=J(e,n),i=r.split(`/`);return(Dt.encode(r).byteLength>4096||i.length>t.maxPathDepth||i.some(e=>!e||e===`.`||e===`..`))&&q(`${n} must be a bounded canonical relative POSIX path`),r}function Ft(e,t){let n=J(e,`package.mount`);return!n.startsWith(`/opt/toolchains/`)&&!n.startsWith(`/usr/share/`)&&q(`Package mounts must be below /opt/toolchains or /usr/share`),Pt(n.slice(1),t,`package.mount`),n}function It(e){wt.has(e)||q(`A distribution must be produced by validateDistribution()`)}async function Lt(e){let t=e.signal;t?.throwIfAborted();let n=Object.freeze({...Ct,...e.limits});for(let[e,t]of Object.entries(n))(!(e in Ct)||!Number.isSafeInteger(t)||t<=0)&&q(`Invalid distribution limit ${e}`);(!(e.bytes instanceof Uint8Array)||e.bytes.byteLength>n.maxManifestBytes)&&q(`Manifest bytes are invalid or exceed the manifest limit`),Tt.test(e.expectedSha256)||q(`An independent expected SHA-256 digest is required`);let r=Uint8Array.from(e.bytes),i=e.expectedSha256,a=new Set(jt(e.adapterIds,n.maxCommands,`adapterIds`)),o=new Set(At(e.allowedAssetURLs,n.maxAssets,`allowedAssetURLs`).map(e=>Nt(e,`allowedAssetURL`)));try{await B({asset:`container-distribution`,bytes:r,expected:i})}catch(e){throw new g(`INTEGRITY`,`Distribution does not match its application lock`,{cause:e})}t?.throwIfAborted();let s;try{s=JSON.parse(new TextDecoder(`utf-8`,{fatal:!0}).decode(r))}catch(e){throw new g(`INVALID_DISTRIBUTION`,`Distribution must be UTF-8 JSON`,{cause:e})}let c=Ot(s,[`schemaVersion`,`distributionId`,`packages`,`commands`],`distribution`);c.schemaVersion!==1&&q(`Unsupported distribution schemaVersion`);let l=kt(c.distributionId,`distributionId`),u=[],d=/* @__PURE__ */ new Map,f=0,p=0,m=0,h=0;for(let e of At(c.packages,n.maxPackages,`packages`)){let t=Ot(e,[`id`,`identity`,`producer`,`dependencies`,`mount`,`capabilities`,`assets`,`files`],`package`),r=kt(t.id,`package.id`);d.has(r)&&q(`Duplicate package ${r}`);let i=J(t.identity,`package.identity`,71);/^sha256:[a-f0-9]{64}$/u.test(i)||q(`Package ${r} needs an immutable sha256 identity`);let a=Ot(t.producer,[`repository`,`revision`,`receiptSha256`],`producer`),s=Nt(a.repository,`producer.repository`),c=J(a.revision,`producer.revision`,64);/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(c)||q(`Producer revision must be an exact source revision`);let l=J(a.receiptSha256,`producer.receiptSha256`,64);Tt.test(l)||q(`Producer receipt SHA-256 is required`);let g=Ft(t.mount,n);for(let e of u)(g===e.mount||g.startsWith(`${e.mount}/`)||e.mount.startsWith(`${g}/`))&&q(`Package mount paths overlap`);let _=At(t.assets,n.maxAssets,`package.assets`).map(e=>{let t=Ot(e,[`id`,`url`,`encoding`,`delivery`,`logical`],`asset`),r=kt(t.id,`asset.id`),i=Nt(t.url,`asset.url`);o.has(i)||q(`Asset URL is not approved: ${i}`),t.encoding!==`identity`&&t.encoding!==`gzip`&&q(`Only direct identity/gzip assets are supported; archives require a separate verified extractor`);let a=Mt(t.delivery,n.maxAssetBytes,`asset.delivery`),s=Mt(t.logical,n.maxFileBytes,`asset.logical`);return t.encoding===`identity`&&(a.sha256!==s.sha256||a.bytes!==s.bytes||a.mediaType!==s.mediaType)&&q(`Identity encoding must preserve byte identity and MIME type`),(++f>n.maxAssets||(m+=a.bytes+s.bytes)>n.maxTotalAssetBytes)&&q(`Distribution asset budget exceeded`),Object.freeze({id:r,url:i,encoding:t.encoding,delivery:a,logical:s})}),v=new Map(_.map(e=>[e.id,e]));v.size!==_.length&&q(`Duplicate asset ID in ${r}`);let y=At(t.files,n.maxFiles,`package.files`).map(e=>{let t=Ot(e,[`path`,`asset`,`executable`],`file`),r=Pt(t.path,n,`file.path`),i=kt(t.asset,`file.asset`),a=v.get(i);return a||q(`Unknown file asset ${i}`),typeof t.executable!=`boolean`&&q(`file.executable must be an explicit boolean`),(++p>n.maxFiles||(h+=a.logical.bytes)>n.maxTotalFileBytes)&&q(`Distribution file budget exceeded`),Object.freeze({path:r,asset:i,executable:t.executable})}),b=/* @__PURE__ */ new Set;for(let e of y)b.has(e.path)&&q(`Duplicate file ${e.path}`),b.add(e.path);for(let e of b){let t=e.split(`/`);for(let n=1;n<t.length;n++)b.has(t.slice(0,n).join(`/`))&&q(`File/directory prefix collision at ${e}`)}let x=Object.freeze({id:r,identity:i,producer:Object.freeze({repository:s,revision:c,receiptSha256:l}),mount:g,dependencies:jt(t.dependencies,n.maxPackages,`package.dependencies`),capabilities:jt(t.capabilities,64,`package.capabilities`),assets:Object.freeze(_),files:Object.freeze(y)});u.push(x),d.set(r,x)}let _=/* @__PURE__ */ new Map,v=/* @__PURE__ */ new Set,y=(e,t)=>{t>n.maxDependencyDepth&&q(`Dependency graph exceeds its depth limit`);let r=d.get(e);r||q(`Unknown package dependency ${e}`),v.has(e)&&q(`Dependency cycle at ${e}`);let i=_.get(e);if(i!==void 0)return t+i-1>n.maxDependencyDepth&&q(`Dependency graph exceeds its depth limit`),i;v.add(e);let a=1;for(let e of r.dependencies)a=Math.max(a,1+y(e,t+1));return v.delete(e),_.set(e,a),a};for(let e of u)y(e.id,1);let b=/* @__PURE__ */ new Set,x=At(c.commands,n.maxCommands,`commands`).map(e=>{let t=Ot(e,[`name`,`package`,`adapter`,`path`,`argv0`,`prefixArgs`],`command`),r=kt(t.name,`command.name`);b.has(r)&&q(`Duplicate command ${r}`),b.add(r);let i=kt(t.package,`command.package`),o=d.get(i);o||q(`Unknown command package ${i}`);let s=kt(t.adapter,`command.adapter`);a.has(s)||q(`Unregistered command adapter ${s}`);let c=Pt(t.path,n,`command.path`);o.files.some(e=>e.path===c&&e.executable)||q(`Command ${r} must refer to an executable package file`);let l=J(t.argv0,`command.argv0`);l||q(`command.argv0 must not be empty`);let u=Object.freeze(At(t.prefixArgs,64,`command.prefixArgs`).map(e=>J(e,`command.prefixArgs`)));return Object.freeze({name:r,package:i,adapter:s,path:c,argv0:l,prefixArgs:u})}),S=Object.freeze({schemaVersion:1,distributionId:l,sha256:i,packages:Object.freeze(u),commands:Object.freeze(x),limits:n});return wt.add(S),S}function Rt(e,t={}){let n={maxArchiveBytes:134217728,maxEntries:16384,maxFileBytes:67108864,maxTotalBytes:134217728,maxDepth:32,...t};for(let[e,t]of Object.entries(n))if(![`maxArchiveBytes`,`maxEntries`,`maxFileBytes`,`maxTotalBytes`,`maxDepth`].includes(e)||!Number.isSafeInteger(t)||t<1)throw new g(`INVALID_ARGUMENT`,`Invalid tar package limit`);let r=e=>{throw new g(`INVALID_DISTRIBUTION`,e)};(!(e instanceof Uint8Array)||e.length>n.maxArchiveBytes||e.length<1024||e.length%512!=0||typeof SharedArrayBuffer==`function`&&e.buffer instanceof SharedArrayBuffer)&&r(`Invalid bounded non-shared tar input`);let i=e,a=new TextDecoder(`utf-8`,{fatal:!0}),o=(e,t)=>{let n=i.subarray(e,e+t),o=n.indexOf(0);o>=0&&n.subarray(o).some(e=>e!==0)&&r(`Nonzero data after tar field terminator`);try{return a.decode(o<0?n:n.subarray(0,o))}catch{return r(`Tar paths must be valid UTF-8`)}},s=(e,t)=>{let n=String.fromCharCode(...i.subarray(e,e+t)).replace(/[\0 ]+$/u,``).trimStart();/^[0-7]+$/u.test(n)||r(`Unsupported tar numeric encoding`);let a=Number.parseInt(n,8);return Number.isSafeInteger(a)||r(`Tar number exceeds safe range`),a},c=/* @__PURE__ */ new Map,l=/* @__PURE__ */ new Set,u=0,d=0,f=0;for(;u+512<=i.length;){let e=i.subarray(u,u+512);if(e.every(e=>e===0))return(u+1024>i.length||i.subarray(u).some(e=>e!==0))&&r(`Invalid tar end marker`),[...c.values()];++f>n.maxEntries&&r(`Tar entry count exceeds limit`);let t=0;for(let n=0;n<512;n++)t+=n>=148&&n<156?32:e[n];t!==s(u+148,8)&&r(`Tar header checksum mismatch`),(o(u+257,6)!==`ustar`||String.fromCharCode(...e.subarray(263,265))!==`00`)&&r(`Only POSIX USTAR regular files and directories are supported`);let a=e[156],p=a===53;a!==0&&a!==48&&!p&&r(`Unsupported tar entry type`),o(u+157,100)&&r(`Link metadata is unsupported`);let m=o(u+345,155),h=o(u,100),g=m?`${m}/${h}`:h;p&&g.endsWith(`/`)&&(g=g.slice(0,-1));let _=g.split(`/`);(new TextEncoder().encode(g).length>4096||_.length>n.maxDepth||_.some(e=>!e||e===`.`||e===`..`)||l.has(g))&&r(`Tar paths must be unique canonical relative paths`),l.add(g);let v=s(u+124,12);(v>n.maxFileBytes||p&&v!==0)&&r(`Invalid tar entry size`),d+=v,d>n.maxTotalBytes&&r(`Tar logical byte budget exceeded`);let y=u+512,b=y+v,x=y+Math.ceil(v/512)*512;(!Number.isSafeInteger(x)||x>i.length||i.subarray(b,x).some(e=>e!==0))&&r(`Truncated tar entry or invalid padding`);for(let e=1;e<_.length;e++){let t=_.slice(0,e).join(`/`),n=c.get(t);n&&n.type!==`directory`&&r(`Tar file/directory prefix conflict`),n||c.set(t,{path:t,type:`directory`,mode:365})}let S=c.get(g);S&&(!p||S.type!==`directory`)&&r(`Tar file/directory prefix conflict`),c.set(g,p?{path:g,type:`directory`,mode:365}:{path:g,type:`file`,mode:292,data:Uint8Array.from(i.subarray(y,b))}),c.size>n.maxEntries&&r(`Tar tree inode budget exceeded`),u=x}return r(`Tar is missing its two-block end marker`)}const zt=e=>new g(`ABORTED`,`Asset consumer canceled`,{cause:e});function Bt(e){if(e?.aborted)throw zt(e.reason)}function Vt(e,t){return new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(zt(t.reason))};t.addEventListener(`abort`,i,{once:!0}),e.then(e=>{t.removeEventListener(`abort`,i),n(e)},e=>{t.removeEventListener(`abort`,i),r(e)}),t.aborted&&i()})}async function Ht(e,t,n){if(typeof DecompressionStream!=`function`)throw new g(`UNSUPPORTED_PROFILE`,`This browser cannot decompress gzip package files`);let r=new Blob([Uint8Array.from(e)]).stream().pipeThrough(new DecompressionStream(`gzip`)).getReader(),i=()=>{r.cancel(n.reason).catch(()=>{})};n.addEventListener(`abort`,i,{once:!0});try{let e=new Uint8Array(t.logical.bytes),i=0;for(;;){Bt(n);let{done:a,value:o}=await Vt(r.read(),n);if(Bt(n),a)break;if(!(o instanceof Uint8Array)||o.byteLength>e.byteLength-i)throw new g(`INTEGRITY`,`Decoded asset exceeds its pinned size: ${t.url}`);e.set(o,i),i+=o.byteLength}if(i!==e.byteLength)throw new g(`INTEGRITY`,`Decoded asset has the wrong size: ${t.url}`);return e}catch(e){throw r.cancel(e).catch(()=>{}),n.aborted?zt(n.reason):e instanceof g?e:new g(`INTEGRITY`,`Invalid gzip asset: ${t.url}`,{cause:e})}finally{n.removeEventListener(`abort`,i);try{r.releaseLock()}catch{}}}function Ut(e){return Wt(e,()=>{})}function Wt(e,t){It(e.distribution);let n=e.distribution,r=Object.freeze(V(e.persistentCache)),i=e.fetch,a=e.maxCachedBytes??67108864,o=e.maxPendingAssets??8,s=e.maxConsumers??128;for(let[e,t]of Object.entries({maxCachedBytes:a,maxPendingAssets:o,maxConsumers:s}))if(!Number.isSafeInteger(t)||t<(e===`maxCachedBytes`?0:1))throw new g(`INVALID_ARGUMENT`,`Invalid asset loader limit ${e}`);let c=new Map(n.packages.map(e=>[e.id,new Map(e.assets.map(e=>[e.id,e]))])),l=/* @__PURE__ */ new Map,u=/* @__PURE__ */ new Set,d=/* @__PURE__ */ new Map,f=0,p=0,m=0,h=!1,_,v=(e,t)=>{if(t.byteLength>a||a===0)return;let r=d.get(e);for(r&&(f-=r.byteLength,d.delete(e));d.size>=n.limits.maxAssets||f+t.byteLength>a;){let e=d.entries().next().value;if(!e)break;d.delete(e[0]),f-=e[1].byteLength}d.set(e,t),f+=t.byteLength},y=async(e,t)=>{try{let a=await Ve({url:e.url,receipt:e.delivery,maxAssetBytes:n.limits.maxAssetBytes,persistentCache:r,fetch:i,signal:t});Bt(t);let o=e.encoding===`gzip`?await Ht(a,e,t):a;return await Vt(B({asset:`${e.url}#logical`,bytes:o,expected:{sha256:e.logical.sha256,bytes:e.logical.bytes}}),t),Bt(t),o}catch(n){if(t.aborted)throw zt(t.reason);if(n instanceof g)throw n;let r=n instanceof Error?n.name:``;throw new g(r===`AssetIntegrityError`?`INTEGRITY`:r===`AssetTooLargeError`?`RESOURCE_LIMIT`:`STARTUP_FAILED`,`Cannot prepare pinned asset ${e.id} (${e.logical.sha256}) from ${e.url}`,{cause:n})}};return Object.freeze({async load(e,r,i={}){if(h)throw new g(`DISPOSED`,`Asset loader has been disposed`);let a=i.signal;Bt(a);let f=c.get(e)?.get(r);if(!f)throw new g(`INVALID_DISTRIBUTION`,`Unknown pinned asset ${e}/${r}`);let _=JSON.stringify([f.url,f.encoding,f.delivery.sha256,f.delivery.bytes,f.delivery.mediaType,f.logical.sha256,f.logical.bytes,f.logical.mediaType,n.limits.maxAssetBytes]),b=d.get(_);if(b)return d.delete(_),d.set(_,b),m++,Uint8Array.from(b);if(p>=s)throw new g(`RESOURCE_LIMIT`,`Too many asset consumers`);let x=l.get(_);if(!x){if(u.size>=o)throw new g(`RESOURCE_LIMIT`,`Too many pending asset requests`);let e=new AbortController,n={controller:e,consumers:/* @__PURE__ */ new Set,promise:Promise.resolve(/* @__PURE__ */ new Uint8Array),settled:!1};n.promise=y(f,e.signal).then(t=>(!h&&!e.signal.aborted&&n.consumers.size>0&&v(_,t),t)).finally(()=>{n.settled=!0,u.delete(n),l.get(_)===n&&l.delete(_),t()}),l.set(_,n),u.add(n),x=n}let S=x;return new Promise((e,t)=>{let n=Symbol();S.consumers.add(n),p++;let r=!1,i=()=>{a?.removeEventListener(`abort`,o),S.consumers.delete(n),p--,!S.settled&&S.consumers.size===0&&(l.get(_)===S&&l.delete(_),S.controller.abort(zt(`All asset consumers canceled`)))},o=()=>{r||(r=!0,i(),t(zt(a?.reason)))};a?.addEventListener(`abort`,o,{once:!0}),S.promise.then(t=>{r||(r=!0,i(),e(Uint8Array.from(t)))},e=>{r||(r=!0,i(),t(e))}),a?.aborted&&o()})},inspect(){return Object.freeze({maxPendingAssets:o,maxConsumers:s,pendingRequests:u.size,consumers:p,cachedEntries:d.size,cachedBytes:f,memoryCacheHits:m})},clearMemoryCache(){d.clear(),f=0},dispose(){if(_)return _;h=!0;let e=[...u];for(let t of e)t.controller.abort(new g(`DISPOSED`,`Asset loader disposed`));return d.clear(),f=0,_=Promise.allSettled(e.map(e=>e.promise)).then(()=>{}),_}})}function Gt(e){It(e.distribution);let t=e.distribution,n=e.maxPreparations??16,r=e.maxConcurrentAssets??3,i=e.maxPreparingBytes??268435456;for(let[e,t]of Object.entries({maxPreparations:n,maxConcurrentAssets:r,maxPreparingBytes:i}))if(!Number.isSafeInteger(t)||t<=0)throw new g(`INVALID_ARGUMENT`,`Invalid package manager limit ${e}`);if(e.capabilities!==void 0&&(!Array.isArray(e.capabilities)||e.capabilities.length>256||e.capabilities.some(e=>typeof e!=`string`||!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/u.test(e))))throw new g(`INVALID_ARGUMENT`,`Capabilities must be a bounded list of host capability IDs`);let a=new Set(e.capabilities??[]),o=new Map(t.packages.map(e=>[e.id,e])),s=new Map(t.commands.map(e=>[e.name,e])),c=Wt(e,()=>p()),l=e.maxPendingAssets??8,u=Math.min(r,l,e.maxConsumers??128),d=/* @__PURE__ */ new Set,f=0,p=()=>{for(;f<u&&c.inspect().pendingRequests<l&&d.size>0;){let e=d.values().next().value;d.delete(e),e()}},m=(e,t,n)=>new Promise((r,i)=>{let a=()=>{d.delete(o),n.removeEventListener(`abort`,a),i(n.reason)},o=()=>{if(n.removeEventListener(`abort`,a),n.aborted){i(n.reason);return}f++,c.load(e,t,{signal:n}).then(r,i).finally(()=>{f--,p()})};d.add(o),n.addEventListener(`abort`,a,{once:!0}),n.aborted&&a(),p()}),h=/* @__PURE__ */ new Set,_=0,v=!1,y,b=()=>{if(v)throw new g(`DISPOSED`,`Package manager has been disposed`)},x=e=>{if(b(),typeof e!=`string`||e.includes(`\0`)||e.length>4096)throw new g(`INVALID_ARGUMENT`,`Command name must be a bounded string without NUL`);return s.get(e.startsWith(`/usr/bin/`)?e.slice(9):e)},S=e=>{let t=/* @__PURE__ */ new Set,n=[],r=e=>{if(t.has(e))return;let i=o.get(e);if(!i)throw new g(`INVALID_DISTRIBUTION`,`Unknown pinned package ${e}`);t.add(e);for(let e of i.dependencies)r(e);n.push(i)};return r(e),n},C=async(e,r,o)=>{b();let s=r.signal;if(s?.aborted)throw new g(`ABORTED`,`Package preparation canceled`,{cause:s.reason});if(h.size>=n)throw new g(`RESOURCE_LIMIT`,`Too many pending package preparations`);let c=S(e),l=0;for(let e of c){for(let t of e.capabilities)if(!a.has(t))throw new g(`UNSUPPORTED_PROFILE`,`Package ${e.id} requires host capability ${t}`);let t=new Map(e.assets.map(e=>[e.id,e]));for(let n of e.files)l+=t.get(n.asset).logical.bytes,o?.package===e.id&&o.path===n.path&&(l+=t.get(n.asset).logical.bytes)}if(!Number.isSafeInteger(l)||l>i-_)throw new g(`RESOURCE_LIMIT`,`Package preparation exceeds the concurrent file-byte budget`);let d=new AbortController,f=()=>d.abort(s?.reason);s?.addEventListener(`abort`,f,{once:!0});let p={packageId:e,controller:d,bytes:l,promise:Promise.resolve({distributionId:t.distributionId,distributionSha256:t.sha256,packages:[]})};return h.add(p),_+=l,p.promise=(async()=>{let e=[];for(let t of c){let n=new Map(t.assets.map(e=>[e.id,e])),r=/* @__PURE__ */ new Map,i=new AbortController,a=()=>i.abort(d.signal.reason);d.signal.addEventListener(`abort`,a,{once:!0}),d.signal.aborted&&a();let o=0,s=Array.from({length:Math.min(u,t.assets.length)},async()=>{try{for(;o<t.assets.length;){i.signal.throwIfAborted();let e=t.assets[o++];r.set(e.id,await m(t.id,e.id,i.signal))}}catch(e){throw i.abort(e),e}});try{if((await Promise.allSettled(s)).some(e=>e.status===`rejected`))throw i.signal.reason}finally{d.signal.removeEventListener(`abort`,a)}let c=t.files.map(e=>{let t=n.get(e.asset);return Object.freeze({path:e.path,bytes:Uint8Array.from(r.get(e.asset)),executable:e.executable,sha256:t.logical.sha256,mediaType:t.logical.mediaType})});e.push(Object.freeze({id:t.id,identity:t.identity,mount:t.mount,files:Object.freeze(c)}))}d.signal.throwIfAborted();let n={distributionId:t.distributionId,distributionSha256:t.sha256,packages:Object.freeze(e)};if(!o)return Object.freeze(n);let r=e.find(e=>e.id===o.package),i=Uint8Array.from(r.files.find(e=>e.path===o.path).bytes);return Object.freeze({...n,command:o,executable:i,executablePath:`${r.mount}/${o.path}`})})().catch(e=>{throw d.signal.aborted?new g(`ABORTED`,`Package preparation canceled`,{cause:d.signal.reason}):e}).finally(()=>{s?.removeEventListener(`abort`,f),h.delete(p),_-=l}),s?.aborted&&f(),p.promise};return Object.freeze({resolveCommand:x,listCommands(){return b(),t.commands},prepare(e,t={}){return C(e,t)},async prepareCommand(e,t={}){let n=x(e);if(!n)throw new g(`COMMAND_NOT_FOUND`,`Command is not in this distribution: ${e}`);return await C(n.package,t,n)},inspect(){return Object.freeze({distributionId:t.distributionId,distributionSha256:t.sha256,pendingPackages:Object.freeze([...h].map(e=>e.packageId)),preparingBytes:_,assets:c.inspect()})},dispose(){if(y)return y;v=!0;for(let e of h)e.controller.abort(new g(`DISPOSED`,`Package manager disposed`));return y=Promise.allSettled([c.dispose(),...[...h].map(e=>e.promise)]).then(()=>{}),y}})}const Y=Object.freeze({cannotExecute:126,notFound:127,timeout:124,filesystemConflict:125,runtimeError:134,interrupted:130,terminated:143});function Kt(e){let t=new TextDecoder(`utf-8`,{fatal:!0}),n=Object.create(null);for(let r of e){if(!(r instanceof Uint8Array))throw new g(`INVALID_ARGUMENT`,`Environment entry must be bytes`);let e;try{e=t.decode(r)}catch{throw new g(`INVALID_ARGUMENT`,`Environment entry is not UTF-8`)}let i=e.indexOf(`=`),a=e.slice(0,i),o=e.slice(i+1);if(i<1||a.includes(`\0`)||o.includes(`\0`)||Object.hasOwn(n,a))throw new g(`INVALID_ARGUMENT`,`Environment entry is not a unique UTF-8 name=value pair`);n[a]=o}return n}function qt(e){switch(e.reason){case`exited`:return e.code&255;case`timeout`:return Y.timeout;case`terminated`:return Y.terminated;case`filesystem-conflict`:return Y.filesystemConflict;default:return Y.runtimeError}}function Jt(e,t){return new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(t.reason)};t.addEventListener(`abort`,i,{once:!0}),t.aborted&&i(),e.then(e=>{t.removeEventListener(`abort`,i),n(e)},e=>{t.removeEventListener(`abort`,i),r(e)})})}async function Yt(e,t,n){try{for(let r=0;r<t.length;){n.throwIfAborted();let i=await Jt(e.write(t.subarray(r)),n);if(!Number.isSafeInteger(i)||i<1||i>t.length-r)return!1;r+=i}return!0}catch{return!1}}async function Xt(e,t,n){e&&await Yt(e,new TextEncoder().encode(t),n)}async function Zt(e,t,n){let r=e.getReader(),i=()=>{r.cancel(n.reason).catch(()=>{})};n.addEventListener(`abort`,i,{once:!0}),n.aborted&&i();let a=t!==null;try{for(;!n.aborted;){let{value:e,done:i}=await r.read();if(i)return;a&&=await Yt(t,e,n)}}finally{n.removeEventListener(`abort`,i),r.releaseLock()}}const Qt=e=>typeof e==`string`&&e.length>1&&e.startsWith(`/`)&&!e.includes(`\0`)&&e.slice(1).split(`/`).every(e=>e&&e!==`.`&&e!==`..`);function $t(e,t){let n=/* @__PURE__ */ new Map;for(let[e,r]of Object.entries(t.routes)){if(!e.startsWith(`/`)||!r||typeof r.command!=`string`||r.args!==void 0&&!Array.isArray(r.args)||r.stdio!==void 0&&r.stdio!==`delegated`&&r.stdio!==`forwarded`)throw new g(`INVALID_ARGUMENT`,`Invalid host command route: ${e}`);n.set(e,Object.freeze({command:r.command,args:Object.freeze([...r.args??[]]),stdio:r.stdio??`delegated`}))}let r=[...t.moduleDirectories??[]];if(!r.every(Qt))throw new g(`INVALID_ARGUMENT`,`Module directories must be normalized absolute paths`);let i=e=>Qt(e)&&r.some(t=>e.startsWith(t+`/`))?{command:`wasm-run`,args:[e],stdio:`delegated`}:void 0,a=e=>(t.onRecord?.(Object.freeze(e)),e.status),o=/* @__PURE__ */ new Set;return Object.assign(async r=>{let s=n.get(r.path)??i(r.path),c=r.argv[0]||r.path,l=s?.stdio===`forwarded`,u=new AbortController,d=()=>u.abort(e.disposalSignal.reason),f=()=>u.signal.reason instanceof g&&u.signal.reason.code===`DISPOSED`?Y.terminated:Y.interrupted,p=()=>{if(l)for(let e of/* @__PURE__ */ new Set([r.stdout,r.stderr]))try{e?.close()}catch{}};u.signal.addEventListener(`abort`,p,{once:!0}),e.disposalSignal.addEventListener(`abort`,d,{once:!0}),e.disposalSignal.aborted&&d(),o.add(u);try{if(!s)return await Xt(r.stderr,`${c}: no container route\n`,u.signal),a({path:r.path,status:u.signal.aborted?f():Y.notFound,startError:`COMMAND_NOT_FOUND`});let n;try{n=await e.spawn(s.command,[...s.args,...r.argv.slice(1)],{cwd:r.cwd,env:Kt(r.env),timeoutMs:t.timeoutMs,signal:u.signal,...l?{}:{stdio:{stdin:r.stdin,stdout:r.stdout,stderr:r.stderr}}})}catch(e){let t=e instanceof g?e.code:e?.code;return u.signal.aborted?a({path:r.path,status:f(),startError:`ABORTED`}):(await Xt(r.stderr,`${c}: ${e instanceof Error?e.message:`cannot start`}\n`,u.signal),a({path:r.path,status:u.signal.aborted?f():t===`COMMAND_NOT_FOUND`?Y.notFound:Y.cannotExecute,startError:typeof t==`string`?t:`STARTUP_FAILED`}))}l&&(await n.stdin.close().catch(()=>{}),await Promise.all([Zt(n.stdout,r.stdout,u.signal),Zt(n.stderr,r.stderr,u.signal)]));let i=await n.exited,o=u.signal.aborted?f():qt(i);return a({path:r.path,pid:n.pid,result:i,status:o})}finally{o.delete(u),u.signal.removeEventListener(`abort`,p),e.disposalSignal.removeEventListener(`abort`,d)}},{interrupt(){let e=[...o];for(let t of e)t.abort(new g(`ABORTED`,`Interrupted by the shell owner`));return e.length}})}const en=e=>Object.freeze({type:e.type,size:e.size,mtimeMs:e.mtimeMs,ctimeMs:e.ctimeMs});function tn(e,t={}){let n=t.root??`/workspace`,r=t.maxIoBytes??1048576,i=t.maxHandles??1024;if(typeof n!=`string`||!n.startsWith(`/`)||!Number.isSafeInteger(r)||r<1||r>16777216||!Number.isSafeInteger(i)||i<1||i>4096)throw new g(`INVALID_ARGUMENT`,`Invalid shell filesystem options`);if(e.stat(n).type!==`directory`)throw new g(`INVALID_ARGUMENT`,`Shell filesystem root must be a directory`);let a={cwd:n,root:n},o=!1,s=e=>{if(o)throw new _(`EBADF`,`Shell filesystem binding is disposed`);if(typeof e!=`string`||!e.startsWith(`/`)||e.includes(`\0`)||e.length>4096)throw new _(`EINVAL`,`Invalid shell path`);return`.`+e},c=/* @__PURE__ */ new Map,l=1,u=e=>{let t=typeof e==`number`?c.get(e):void 0;if(!t)throw new _(`EBADF`,`Unknown shell file handle`);return t},d=(e,t)=>{if(typeof e!=`number`||!Number.isSafeInteger(e)||e<0||e>t)throw new _(`EINVAL`,`Invalid shell I/O number`);return e};return Object.freeze({stat:t=>en(e.stat(s(t),a)),lstat:t=>en(e.lstat(s(t),a)),readdir:t=>{let n=s(t);return e.readdir(n,a).map(t=>Object.freeze({name:t,type:e.lstat(`${n}/${t}`,a).type}))},mkdir:t=>{e.mkdir(s(t),a)},rmdir:t=>{e.rmdir(s(t),a)},unlink:t=>{e.unlink(s(t),a)},rename:(t,n)=>{e.rename(s(t),s(n),a)},readlink:t=>e.readlink(s(t),a),open:(t,n)=>{if(c.size>=i||l>=2147483647)throw new _(`ENOSPC`,`Shell file handle budget exceeded`);if(!n||typeof n!=`object`)throw new _(`EINVAL`,`Invalid open flags`);let r=e.open(s(t),{...a,read:!!n.read,write:!!n.write,create:!!n.create,exclusive:!!n.exclusive,truncate:!!n.truncate,append:!!n.append,snapshot:`preserve`}),o=l++;return c.set(o,{fd:r,append:!!n.append}),o},read:(t,n,i)=>e.pread(u(t).fd,d(i,r),d(n,2**53-1)),write:(t,n,i)=>{if(!(i instanceof Uint8Array)||i.length>r)throw new _(`EINVAL`,`Invalid shell write`);return e.pwrite(u(t).fd,i.slice(),d(n,2**53-1))},append:(t,n)=>{let i=u(t);if(!i.append||!(n instanceof Uint8Array)||n.length>r)throw new _(`EINVAL`,`Invalid shell append`);return e.write(i.fd,n.slice())},fstat:t=>en(e.fstat(u(t).fd)),truncate:(t,n)=>{e.ftruncate(u(t).fd,d(n,2**53-1))},close:t=>{let n=u(t);c.delete(t),e.close(n.fd)},dispose:()=>{if(o)return;o=!0;let t=[];for(let n of c.values())try{e.close(n.fd)}catch(e){t.push(e)}if(c.clear(),t.length)throw AggregateError(t,`Shell filesystem descriptor cleanup failed`)}})}const nn=/* @__PURE__ */ new WeakSet,rn=e=>typeof e==`string`&&e.startsWith(`/`)&&e.length>1&&e.length<=4096&&!e.includes(`\0`)&&e.slice(1).split(`/`).every(e=>e&&e!==`.`&&e!==`..`),an=async e=>Array.from(new Uint8Array(await crypto.subtle.digest(`SHA-256`,Uint8Array.from(e))),e=>e.toString(16).padStart(2,`0`)).join(``);function X(e,t,n){return new Promise((r,i)=>{let a=!1,o=()=>{a=!0,t.removeEventListener(`abort`,o),i(t.reason)};t.addEventListener(`abort`,o,{once:!0}),Promise.resolve(e).then(e=>{t.removeEventListener(`abort`,o),a?n?.(e):r(e)},e=>{t.removeEventListener(`abort`,o),i(e)}).catch(()=>{}),t.aborted&&o()})}function on(e){let{stdin:t,stdout:n,stderr:r}=e;t&&t.abort().catch(()=>{});for(let e of[n,r])e.cancel().catch(()=>{});typeof e.waitForExit==`function`&&e.waitForExit().catch(()=>{})}async function sn(e){if(e={...e,sdkAsset:{...e.sdkAsset},shellAsset:{...e.shellAsset},memory:{...e.memory},routes:Object.fromEntries(Object.entries(e.routes).map(([e,t])=>[e,{...t,args:t.args&&[...t.args]}])),moduleDirectories:e.moduleDirectories&&[...e.moduleDirectories],mounts:e.mounts&&[...e.mounts],args:e.args&&[...e.args],env:e.env&&{...e.env}},globalThis.crossOriginIsolated!==!0||typeof SharedArrayBuffer!=`function`||e.workers.inspect().disposed||nn.has(e.workers))throw new g(`UNSUPPORTED_PROFILE`,`WASIX requires isolation and a fresh dedicated SDK Worker group`);let{initial:t,maximum:n}=e.memory;if(!Number.isSafeInteger(t)||!Number.isSafeInteger(n)||t<1||n<t||n>65536||!/^[a-f0-9]{64}$/.test(e.shellWasmSha256))throw new g(`INVALID_ARGUMENT`,`Pinned Bash identity and bounded shared SDK memory are required`);for(let t of[e.sdkUrl,e.workerUrl]){let e=new URL(t);if(![`http:`,`https:`].includes(e.protocol)||e.username||e.password||e.hash)throw new g(`INVALID_ARGUMENT`,`SDK bootstrap URLs must be explicit static application URLs`)}let r=N(`bash`,e.args??[`--noprofile`,`--norc`],{cwd:e.cwd,env:e.env}),i=[...e.mounts??[`/workspace`,`/tmp`,`/home/user`]],a=/* @__PURE__ */ new Map;for(let t of Object.keys(e.routes)){if(!rn(t))throw new g(`INVALID_ARGUMENT`,`Shell command routes require canonical absolute paths`);let e=t.lastIndexOf(`/`),n=t.slice(0,e);if(!n||i.some(e=>t===e||t.startsWith(e+`/`)))throw new g(`INVALID_ARGUMENT`,`Command namespace must be separate from writable shell mounts`);let r=a.get(n)??[];r.push(t.slice(e+1)),a.set(n,r)}let o=[...i,...a.keys()];if(o.length>32||!o.every(rn)||o.some((e,t)=>o.some((n,r)=>r!==t&&(e===n||e.startsWith(n+`/`)))))throw new g(`INVALID_ARGUMENT`,`Shell mounts require distinct non-overlapping canonical directories`);for(let t of i)if(e.container.fs.stat(t).type!==`directory`)throw new g(`INVALID_ARGUMENT`,`Shell mount is not a directory`);let s=$t(e.container,{routes:e.routes,moduleDirectories:e.moduleDirectories,timeoutMs:e.timeoutMs,onRecord:e.onRecord});nn.add(e.workers);let c=new AbortController,l=[e.signal,e.container.disposalSignal,e.workers.failure].filter(e=>!!e),u=`terminated`,d=l.map(t=>{let n=()=>{t===e.workers.failure&&(u=`runtime-error`),c.abort(t.reason)};return t.addEventListener(`abort`,n,{once:!0}),t.aborted&&n(),()=>t.removeEventListener(`abort`,n)}),f=/* @__PURE__ */ new Map,p=()=>{let e=f.size;for(let e of f.keys())e.abort(new g(`ABORTED`,`Interrupted by the shell owner`));return s.interrupt(),e},m=t=>{let n=new AbortController,r=()=>n.abort(c.signal.reason);c.signal.addEventListener(`abort`,r,{once:!0}),c.signal.aborted&&r();let i=Promise.resolve().then(async()=>{try{if(!Object.hasOwn(e.routes,t.path)){let n=e.container.fs.stat(t.path);if(n.type!==`file`||!(n.mode&73)||n.command)throw new g(`UNSUPPORTED_PROFILE`,`Artifact is not marked executable; use an explicit wasm-run command`)}return e.prepareCommand&&await X(e.prepareCommand(t,n.signal),n.signal),n.signal.throwIfAborted(),await s(t)}catch(r){let i=n.signal.aborted?Y.interrupted:Y.cannotExecute;return e.onRecord?.(Object.freeze({path:t.path,status:i,startError:r instanceof g?r.code:`STARTUP_FAILED`})),i}finally{c.signal.removeEventListener(`abort`,r),f.delete(n)}});return f.set(n,i),i},h,_,v,y=[],b=[],x=[],S,C=()=>S??=(async()=>{p();let t=[];try{await e.workers.dispose()}catch(e){t.push(e)}await Promise.allSettled([...f.values()]);for(let e of[...y,v,_,h])try{e?.free?.()}catch(e){t.push(e)}for(let e of b)try{e.dispose()}catch(e){t.push(e)}for(let e of d)e();if(t.length)throw AggregateError(t,`WASIX session cleanup failed`)})();try{c.signal.throwIfAborted();let i=e.assets.inspect?.(),s=!i||Math.min((i.maxPendingAssets??1/0)-i.pendingRequests,(i.maxConsumers??1/0)-i.consumers)>=2,l=t=>X(new Promise(n=>{c.signal.throwIfAborted(),n(e.assets.load(t.packageId,t.assetId,{signal:c.signal}))}),c.signal),d=l(e.sdkAsset),f=s?l(e.shellAsset):d.then(()=>l(e.shellAsset)),S=d.then(async r=>{c.signal.throwIfAborted();let i=await X(WebAssembly.compile(Uint8Array.from(r)),c.signal);await X(e.sdk.init({module:i,memory:new WebAssembly.Memory({initial:t,maximum:n,shared:!0}),sdkUrl:e.sdkUrl,workerUrl:e.workerUrl}),c.signal)});x=[d,f,S];let[,w]=await Promise.all([S,f]);c.signal.throwIfAborted(),h=new e.sdk.Runtime({registry:null});for(let t of Object.keys(e.routes))h.registerHostCommand(t,m);for(let t of e.moduleDirectories??[])h.registerHostCommandDirectory(t,m);let T=await X(e.sdk.Wasmer.fromFile(w,h),c.signal,e=>{try{e.entrypoint?.free?.()}finally{e.free?.()}});if(_=T,v=T.entrypoint,!v||await an(v.binary())!==e.shellWasmSha256)throw new g(`INTEGRITY`,`Bash executable identity does not match the trusted pin`);c.signal.throwIfAborted(),e.container.fs.mountReadonlyPackages([...a].map(([e,t])=>({path:e,entries:t.map(e=>({path:e,type:`file`,mode:365,command:!0,data:/* @__PURE__ */ new Uint8Array}))})));let E={};for(let t of o){let n=tn(e.container.fs,{root:t});b.push(n);let r=e.sdk.Directory.fromHostFileSystem(n);y.push(r),E[t]=r}let D=await X(v.run({args:[...r.args],cwd:r.cwd,env:{...r.env},mount:E,rawStdin:!0}),c.signal,on),O=D.stdin,k=D.stdout,A=D.stderr;if(!O||typeof D.waitForExit!=`function`)throw new g(`UNSUPPORTED_PROFILE`,`SDK requires rawStdin and exit-only streaming support`);let j=O.getWriter(),M=[k.getReader(),A.getReader()],N,P=new Promise(e=>{N=e}),F,I=e=>F??=(async()=>{j.abort(new g(`ABORTED`,`Shell input is closed`)).catch(()=>{}).finally(()=>{try{j.releaseLock()}catch{}});try{await C()}catch{e={code:null,reason:`runtime-error`}}N(Object.freeze(e))})(),L=e=>new ReadableStream({async pull(t){try{let{done:n,value:r}=await X(M[e].read(),c.signal);if(n){M[e].releaseLock(),t.close();return}if(!(r instanceof Uint8Array)||r.length>65536)throw new g(`RESOURCE_LIMIT`,`SDK output exceeds the qualified 64 KiB stream chunk`);t.enqueue(r.slice())}catch(n){if(c.signal.aborted){try{M[e].releaseLock()}catch{}t.close()}else t.error(n),u=`runtime-error`,c.abort(n)}},async cancel(t){try{await X(M[e].cancel(t),c.signal)}finally{M[e].releaseLock()}}},{highWaterMark:0}),R=new WritableStream({async write(e){if(F)throw new g(`DISPOSED`,`Shell input is closed`);if(!(e instanceof Uint8Array)||e.length>65536)throw new g(`RESOURCE_LIMIT`,`Shell input chunks must be at most 64 KiB`);await X(j.write(e.slice()),c.signal)},async close(){await X(j.close(),c.signal),j.releaseLock()},abort(e){c.abort(e)}},{highWaterMark:1}),ee=()=>(c.abort(new g(`ABORTED`,`Shell group terminated`)),I({code:null,reason:u})),z=()=>{j.abort(c.signal.reason).catch(()=>{});for(let e of M)e.cancel(c.signal.reason).catch(()=>{}).finally(()=>{try{e.releaseLock()}catch{}});I({code:null,reason:u})};return c.signal.addEventListener(`abort`,z,{once:!0}),c.signal.aborted&&z(),D.waitForExit().then(e=>{if(!Number.isSafeInteger(e.code)||e.code<0||e.code>4294967295)throw new g(`STARTUP_FAILED`,`SDK returned an invalid exit status`);return I({code:e.code,reason:`exited`})}).catch(e=>{u=`runtime-error`,c.abort(e)}),Object.freeze({pid:0,stdin:R,stdout:L(0),stderr:L(1),exited:P,interrupt:p,terminate:ee,dispose:ee})}catch(e){let t=c.signal.aborted;throw c.abort(e),await Promise.allSettled(x),await C().catch(()=>{}),e instanceof g?e:new g(t?`ABORTED`:`STARTUP_FAILED`,`WASIX shell could not start`,{cause:e})}}const cn=/* @__PURE__ */ new WeakSet;function ln(e={}){let t=e.scope??globalThis,n=e.maxWorkers??32;if(t.document!==void 0||typeof t.Worker!=`function`||!Number.isSafeInteger(n)||n<1||n>256||cn.has(t))throw new g(`UNSUPPORTED_PROFILE`,`WASIX needs one dedicated owner Worker and a bounded worker group`);let r=t.Worker,i=/* @__PURE__ */ new Set,a=new AbortController,o=!1,s=0,c=0;class l extends r{constructor(e,t){if(o||i.size>=n){let e=new g(o?`DISPOSED`:`RESOURCE_LIMIT`,`WASIX worker group cannot allocate another Worker`);throw a.abort(e),e}super(e,t),i.add(this),s++,this.addEventListener(`error`,this.failed),this.addEventListener(`messageerror`,this.failed)}failed=()=>a.abort(new g(`STARTUP_FAILED`,`A worker in the WASIX group failed`));terminate(){i.has(this)&&(super.terminate(),i.delete(this),this.removeEventListener(`error`,this.failed),this.removeEventListener(`messageerror`,this.failed),c++)}}t.Worker=l,cn.add(t);let u;return Object.freeze({failure:a.signal,inspect:()=>Object.freeze({active:i.size,created:s,terminated:c,maxWorkers:n,disposed:o}),dispose(){if(u)return u;o=!0;let e=[];for(let t of[...i])try{t.terminate()}catch(t){e.push(t)}return u=e.length?Promise.reject(AggregateError(e,`WASIX Worker cleanup failed`)):Promise.resolve(),u.catch(()=>{}),u}})}function un(e){let{workerFactory:t}=e;return{id:e.id,filesystem:`snapshot`,async start(n){n.signal.throwIfAborted();let r=t(),i,a,o=new Promise((e,t)=>{i=e,a=t}),s,c,l=new Promise((e,t)=>{s=e,c=t});l.catch(()=>{});let u=!1,d=!1,f=!1,p,m=()=>p??=(async()=>{u=!0,n.signal.removeEventListener(`abort`,_),r.onmessage=null,r.onerror=null,r.onmessageerror=null,a(new g(`ABORTED`,`Worker stopped`)),c(new g(`ABORTED`,`Worker stopped`)),await r.terminate()})(),h=e=>{a(e),c(e),m().catch(()=>{})},_=()=>h(new g(`ABORTED`,`Command cancelled`,{cause:n.signal.reason}));r.onmessage=({data:e})=>{if(!u){if(!e||e.version!==1||e.generation!==n.generation){h(new g(`STARTUP_FAILED`,`Invalid worker channel generation`));return}e.type===`ready`&&!f?(f=!0,i()):e.type===`complete`&&d&&Number.isSafeInteger(e.code)&&e.code>=0&&e.stdout instanceof Uint8Array&&e.stderr instanceof Uint8Array&&e.stdout.length+e.stderr.length<=n.limits.maxOutputBytes?s(e):e.type===`error`?h(new g(f?`RESOURCE_LIMIT`:`UNSUPPORTED_PROFILE`,typeof e.message==`string`?e.message.slice(0,512):`Worker failure`)):h(new g(`STARTUP_FAILED`,`Invalid worker response`))}},r.onerror=()=>h(new g(`STARTUP_FAILED`,`Command worker crashed`)),r.onmessageerror=()=>h(new g(`STARTUP_FAILED`,`Command message could not be decoded`)),n.signal.addEventListener(`abort`,_,{once:!0}),n.signal.aborted&&_();try{return u||r.postMessage({type:`prepare`,version:1,configuration:e.configuration,generation:n.generation,command:n.command,invocation:{command:n.invocation.command,args:n.invocation.args,cwd:n.invocation.cwd,env:n.invocation.env},snapshot:n.snapshot,limits:n.limits}),await o,{run(e){return u||d?Promise.reject(new g(`STARTUP_FAILED`,`Worker run is single-use`)):(d=!0,r.postMessage({type:`run`,version:1,generation:n.generation,stdin:e}),l)},dispose:m}}catch(e){throw await m(),e}}}}function dn(e){if(!e||!/^[a-f0-9]{64}$/u.test(e.clangSha256)||!/^[a-f0-9]{64}$/u.test(e.linkerSha256)||typeof e.linkerPath!=`string`||!e.linkerPath.startsWith(`/opt/toolchains/`)||e.linkerPath.includes(`\0`)||e.linkerPath.includes(`\\`)||new TextEncoder().encode(e.linkerPath).length>4096||e.linkerPath.slice(1).split(`/`).some(e=>!e||e===`.`||e===`..`)||e.executableOutputProfile!==void 0&&e.executableOutputProfile!==`wasi-preview1-process`)throw new g(`INVALID_ARGUMENT`,`Clang requires pinned tool digests and a canonical readonly linker path`);if(e.compilerPaths!==void 0&&(!Array.isArray(e.compilerPaths)||e.compilerPaths.length>16||e.compilerPaths.some(t=>typeof t!=`string`||!t.startsWith(`/`)||t.includes(`\0`)||t.includes(`\\`)||t.slice(1).split(`/`).some(e=>!e||e===`.`||e===`..`)||new TextEncoder().encode(t).length>4096||new TextDecoder(`utf-8`,{fatal:!0}).decode(new TextEncoder().encode(t))!==t||t===e.linkerPath)))throw new g(`INVALID_ARGUMENT`,`Compiler aliases must be bounded canonical absolute filesystem paths`);return Object.freeze({clangSha256:e.clangSha256,linkerSha256:e.linkerSha256,linkerPath:e.linkerPath,compilerPaths:Object.freeze([...e.compilerPaths??[]]),executableOutputProfile:e.executableOutputProfile})}function fn(e){return un({id:`llvm-clang-tool-host-v1`,configuration:dn(e),workerFactory:e.workerFactory??(()=>new Worker(new URL(
/* @vite-ignore */
new URL(`worker-naGRGsgS.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`wasm-idle-clang`}))})}const pn=65536;var Z;(function(e){e[e.Open=1]=`Open`,e[e.Close=2]=`Close`,e[e.Stat=3]=`Stat`,e[e.Lstat=4]=`Lstat`,e[e.Fstat=5]=`Fstat`,e[e.DirectoryPath=6]=`DirectoryPath`,e[e.Read=7]=`Read`,e[e.Pread=8]=`Pread`,e[e.Write=9]=`Write`,e[e.Pwrite=10]=`Pwrite`,e[e.Seek=11]=`Seek`,e[e.Tell=12]=`Tell`,e[e.Truncate=13]=`Truncate`,e[e.Realpath=14]=`Realpath`,e[e.Readdir=15]=`Readdir`,e[e.Mkdir=16]=`Mkdir`,e[e.Unlink=17]=`Unlink`,e[e.Rmdir=18]=`Rmdir`,e[e.Readlink=19]=`Readlink`,e[e.Symlink=20]=`Symlink`,e[e.Rename=21]=`Rename`,e[e.Stdin=22]=`Stdin`,e[e.Stdout=23]=`Stdout`,e[e.StdioClose=24]=`StdioClose`,e[e.PathOpen=25]=`PathOpen`,e[e.PathStat=26]=`PathStat`,e[e.PathMkdir=27]=`PathMkdir`,e[e.PathUnlink=28]=`PathUnlink`,e[e.PathRmdir=29]=`PathRmdir`,e[e.PathReadlink=30]=`PathReadlink`,e[e.PathSymlink=31]=`PathSymlink`,e[e.PathRename=32]=`PathRename`,e[e.DirectoryEntries=33]=`DirectoryEntries`,e[e.SetTimes=34]=`SetTimes`,e[e.FsetTimes=35]=`FsetTimes`,e[e.PathSetTimes=36]=`PathSetTimes`})(Z||={});const mn=new TextEncoder,hn=new TextDecoder(`utf-8`,{fatal:!0});function gn(e,t){if(!(e instanceof SharedArrayBuffer)||e.byteLength!==131136||!Number.isSafeInteger(t)||t<1)throw Error(`Invalid RPC channel`);let n=new Int32Array(e,0,16);return{header:n,metadata:new Uint8Array(e,64,pn),data:new Uint8Array(e,65600,pn),identity:()=>{if(Atomics.load(n,1)!==1||Atomics.load(n,2)>>>0!=t>>>0||Atomics.load(n,3)!==Math.floor(t/2**32))throw Error(`Invalid RPC generation`)},lengths:()=>{let e=Atomics.load(n,6),t=Atomics.load(n,7);if(e<1||e>65536||t<0||t>65536)throw Error(`Invalid RPC payload length`);return[e,t]},stop:()=>{Atomics.store(n,0,3),Atomics.notify(n,0)}}}function _n(e){let t=new SharedArrayBuffer(131136),n=gn(t,e);return n.header[1]=1,n.header[2]=e>>>0,n.header[3]=Math.floor(e/2**32),t}function vn(e,t){let{header:n}=gn(e,t);return e=>{if(!Number.isSafeInteger(e)||e<0)throw Error(`Invalid filesystem revision`);Atomics.store(n,9,e|0),Atomics.store(n,10,1)}}function yn(e,t,n){let r=gn(e,t),i=0,a=!1,o=!1;return{stop(){o=!0,r.stop()},async accept(e){if(o)return;if(r.identity(),a||!e||e.type!==`io`||e.version!==1||e.generation!==t||e.id!==i+1||e.id>2147483647||Atomics.load(r.header,0)!==1||r.header[4]!==e.id)throw Error(`Invalid RPC request sequence`);let s=r.header[5];if(s<Z.Open||s>Z.PathSetTimes)throw Error(`Invalid RPC operation`);let[c,l]=r.lengths(),u=JSON.parse(hn.decode(r.metadata.slice(0,c)));if(!Array.isArray(u)||u.length>4||r.header[8]!==0)throw Error(`Invalid RPC arguments`);let d=r.data.slice(0,l);a=!0,i=e.id;let f,p=0;try{f=await n(s,u,d)}catch(e){if(!(e instanceof _))throw e;f={value:e.code},p=1}if(o)return;if(r.identity(),Atomics.load(r.header,0)!==1||r.header[4]!==e.id||r.header[5]!==s)throw Error(`RPC request changed during I/O`);let m=mn.encode(JSON.stringify(f.value??null));if(m.length>65536||(f.bytes?.length??0)>65536)throw Error(`RPC response exceeds bounded channel`);r.metadata.set(m),f.bytes&&r.data.set(f.bytes),r.header[6]=m.length,r.header[7]=f.bytes?.length??0,r.header[8]=p,a=!1,Atomics.store(r.header,0,2),Atomics.notify(r.header,0)}}}const bn=/* @__PURE__ */ new Set([`EINVAL`,`EBADF`,`EACCES`,`EISDIR`,`ENOTSUP`,`ENOSPC`,`EPIPE`,`EIO`]);function xn(e){let t=e?.code;return new _(typeof t==`string`&&bn.has(t)?t:`EIO`,`Delegated descriptor failed`)}function Sn(e,t,n,r,i,a){let o=F(n),s=F(n),c=F(n),l=/* @__PURE__ */ new Map,u=/* @__PURE__ */ new Set,d=/* @__PURE__ */ new Map,f=3,p=!1,m=!1,h=0,v=0,y=()=>{m||(m=!0,o.writer.close())},b=e=>{if(u.has(e))throw new _(`EBADF`,`Standard descriptor closed`);u.add(e);let t=d.get(e);if(t){d.delete(e);try{t.close()}catch(e){throw xn(e)}return}e===0?o.reader.close():(e===1?s:c).writer.close()};for(let[e,t]of[[0,`stdin`],[1,`stdout`],[2,`stderr`]]){if(!i||!(t in i))continue;let n=i[t];e===0?(m=!0,o.writer.close(),o.reader.close()):(e===1?s:c).writer.close(),n?d.set(e,n):u.add(e)}let x=(e,t=!1)=>{if(typeof e!=`number`||!Number.isSafeInteger(e)||!t&&e<0)throw new _(`EINVAL`,`Invalid I/O number`);return e},S=e=>{if(typeof e!=`string`||e.length>4096||e.includes(`\0`))throw new _(`EINVAL`,`Invalid I/O path`);return e},C=(e,t=!1,n=!1)=>{if(!e||typeof e!=`object`||Array.isArray(e))throw new _(`EINVAL`,`Invalid path options`);for(let[r,i]of Object.entries(e))if(!n&&(r===`cwd`||r===`root`))S(i);else if(t&&r===`mode`)x(i);else if(t&&[`read`,`write`,`resize`,`create`,`exclusive`,`truncate`,`append`,`directory`].includes(r)&&typeof i==`boolean`)continue;else throw new _(`EINVAL`,`Unsupported path option`);return e},w=e=>{let t=l.get(x(e));if(t===void 0)throw new _(`EBADF`,`Descriptor does not belong to this process`);return t},T=e=>w(e).fd,E=t=>{if(!t||typeof t!=`object`||Array.isArray(t)||Object.keys(t).length!==3||!Object.keys(t).every(e=>[`directory`,`path`,`root`].includes(e)))throw new _(`EINVAL`,`Invalid path reference`);let n=t,r=w(n.directory),i=S(n.path);if(i.startsWith(`/`)||S(n.root)!==r.root)throw new _(`EACCES`,`Path exceeds directory capability`);return{path:i,cwd:e.getDirectoryPath(r.fd),root:r.root}},D=e=>{if(typeof e!=`boolean`)throw new _(`EINVAL`,`Invalid lookup flags`);return e},O=e=>{if(!e||typeof e!=`object`||Array.isArray(e))throw new _(`EINVAL`,`Invalid timestamp update`);for(let[t,n]of Object.entries(e)){if(t!==`atimeMs`&&t!==`mtimeMs`)throw new _(`EINVAL`,`Unsupported timestamp field`);n!==`now`&&x(n)}return e},k=(t,n,r,i=!0)=>{if(l.size>=256||f>=2147483647)throw new _(`ENOSPC`,`Descriptor budget exceeded`);if(!i)try{if(e.lstat(t,n).type===`symlink`)throw new _(`ELOOP`,`Final symlink requires follow permission`)}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e}let o;if(a&&!n.directory&&(n.create||n.truncate))try{e.stat(t,n).type===`file`&&(o=e.captureFileVersion(t,n))}catch(e){if(!(e instanceof _)||![`ENOENT`,`EISDIR`].includes(e.code))throw e}let s=e.open(t,n),c=f++;if(l.set(c,{fd:s,root:r}),a&&!n.directory&&(n.create||n.truncate)&&e.fstat(s).type===`file`){let t=e.captureFileVersion(s);t!==o&&a(`write`,t,o)}return c},A=(t,n)=>a&&e.lstat(t,n).type===`file`?e.captureFileVersion(t,n):void 0,j=(t,n,r)=>{r&&a(`rename`,e.captureFileVersion(t,n),r)},M=e=>{let t=x(e);if(t>65536)throw new _(`EINVAL`,`I/O exceeds channel`);return t},N=I(s.reader),L=I(c.reader);return{stdin:new WritableStream({start(e){e.signal.addEventListener(`abort`,y,{once:!0})},async write(e){if(!(e instanceof Uint8Array))throw new g(`INVALID_ARGUMENT`,`stdin requires bytes`);if(h+e.length>t.maxInputBytes){let e=new g(`RESOURCE_LIMIT`,`Live stdin exceeds configured limit`);throw r(e),e}h+=e.length;let n=Uint8Array.from(e),i=0;for(;i<n.length;)i+=await o.writer.write(n.subarray(i))},close:y,abort:y},{highWaterMark:1}),stdout:N,stderr:L,openStdio:Object.freeze([0,1,2].filter(e=>!u.has(e))),dispose(){if(!p){p=!0;for(let e of d.keys())u.add(e);d.clear();for(let e of[0,1,2])u.has(e)||b(e);for(let t of l.values())e.close(t.fd);l.clear()}},async dispatch(n,r,i){if(p)throw new _(`EBADF`,`Process I/O is closed`);let f={[Z.Open]:2,[Z.Close]:1,[Z.Stat]:2,[Z.Lstat]:2,[Z.Fstat]:1,[Z.DirectoryPath]:1,[Z.Read]:2,[Z.Pread]:3,[Z.Write]:1,[Z.Pwrite]:2,[Z.Seek]:3,[Z.Tell]:1,[Z.Truncate]:2,[Z.Realpath]:2,[Z.Readdir]:2,[Z.Mkdir]:2,[Z.Unlink]:2,[Z.Rmdir]:2,[Z.Readlink]:2,[Z.Symlink]:3,[Z.Rename]:3,[Z.Stdin]:1,[Z.Stdout]:1,[Z.StdioClose]:1,[Z.PathOpen]:3,[Z.PathStat]:2,[Z.PathMkdir]:1,[Z.PathUnlink]:1,[Z.PathRmdir]:1,[Z.PathReadlink]:1,[Z.PathSymlink]:2,[Z.PathRename]:2,[Z.DirectoryEntries]:1,[Z.SetTimes]:4,[Z.FsetTimes]:2,[Z.PathSetTimes]:3};if(r.length!==f[n]||i.length>65536||i.length&&![Z.Write,Z.Pwrite,Z.Stdout].includes(n))throw new _(`EINVAL`,`Invalid I/O arguments`);let[m,h,y,N]=r,F=null;try{switch(n){case Z.Open:{let t=C(h,!0),n=e.realpath(t.root??`/`);F=k(S(m),t,n);break}case Z.Close:e.close(T(m)),l.delete(x(m));break;case Z.Stat:F=e.stat(S(m),C(h));break;case Z.Lstat:F=e.lstat(S(m),C(h));break;case Z.Fstat:F=e.fstat(T(m));break;case Z.SetTimes:e.setTimes(S(m),O(h),C(y),D(N));break;case Z.FsetTimes:e.fsetTimes(T(m),O(h));break;case Z.DirectoryPath:F=e.getDirectoryPath(T(m));break;case Z.Read:return{bytes:e.read(T(m),M(h))};case Z.Pread:return{bytes:e.pread(T(m),M(h),x(y))};case Z.Write:{let t=a&&e.fstat(T(m)).type===`file`?e.captureFileVersion(T(m)):void 0;F=e.write(T(m),i),F&&t&&a(`write`,e.captureFileVersion(T(m)),t);break}case Z.Pwrite:{let t=a&&e.fstat(T(m)).type===`file`?e.captureFileVersion(T(m)):void 0;F=e.pwrite(T(m),i,x(h)),F&&t&&a(`write`,e.captureFileVersion(T(m)),t);break}case Z.Seek:if(y!==`set`&&y!==`cur`&&y!==`end`)throw new _(`EINVAL`,`Invalid seek origin`);F=e.seek(T(m),x(h,!0),y);break;case Z.Tell:F=e.tell(T(m));break;case Z.Truncate:{let t=a&&e.fstat(T(m)).type===`file`?e.captureFileVersion(T(m)):void 0;e.ftruncate(T(m),x(h)),t&&a(`write`,e.captureFileVersion(T(m)),t);break}case Z.Realpath:F=e.realpath(S(m),C(h));break;case Z.Readdir:{let t=e.readdir(S(m),C(h)),n=2;for(let e of t)if(n+=new TextEncoder().encode(JSON.stringify(e)).length+1,n>65536)throw new _(`ENOSPC`,`Directory listing exceeds live profile metadata limit`);F=t;break}case Z.Mkdir:e.mkdir(S(m),C(h));break;case Z.Unlink:e.unlink(S(m),C(h));break;case Z.Rmdir:e.rmdir(S(m),C(h));break;case Z.Readlink:F=e.readlink(S(m),C(h));break;case Z.Symlink:e.symlink(S(m),S(h),C(y));break;case Z.Rename:{let t=C(y),n=A(S(m),t);e.rename(S(m),S(h),t),j(S(h),t,n);break}case Z.PathOpen:{let e=E(m),t=C(h,!0,!0);F=k(e.path,{...t,cwd:e.cwd,root:e.root},e.root,D(y));break}case Z.PathStat:{let t=E(m);F=D(h)?e.stat(t.path,t):e.lstat(t.path,t);break}case Z.PathSetTimes:{let t=E(m);e.setTimes(t.path,O(h),t,D(y));break}case Z.PathMkdir:{let t=E(m);e.mkdir(t.path,t);break}case Z.PathUnlink:{let t=E(m);e.unlink(t.path,t);break}case Z.PathRmdir:{let t=E(m);e.rmdir(t.path,t);break}case Z.PathReadlink:{let t=E(m);F=e.readlink(t.path,t);break}case Z.PathSymlink:{let t=E(h);e.symlink(S(m),t.path,t);break}case Z.PathRename:{let t=E(m),n=E(h);if(t.root!==n.root)throw new _(`EACCES`,`Rename requires a common root capability`);let r={root:t.root,cwd:t.root},i=A(`${t.cwd}/${t.path}`,r);e.rename(`${t.cwd}/${t.path}`,`${n.cwd}/${n.path}`,r),j(`${n.cwd}/${n.path}`,r,i);break}case Z.DirectoryEntries:{let t=w(m),n={cwd:e.getDirectoryPath(t.fd),root:t.root},r=[],i=2;for(let t of e.readdir(`.`,n)){let a={name:t,stat:e.lstat(t,n)};if(i+=new TextEncoder().encode(JSON.stringify(a)).length+1,i>65536)throw new _(`ENOSPC`,`Directory listing exceeds live profile metadata limit`);r.push(a)}F=r;break}case Z.Stdin:{if(u.has(0))throw new _(`EBADF`,`stdin is closed`);let e=M(m),t=d.get(0);if(!t)return{bytes:await o.reader.read(e)};if(!e)return{bytes:/* @__PURE__ */ new Uint8Array};let n;try{n=await t.read(e)}catch(e){throw xn(e)}if(!(n instanceof Uint8Array)||n.length>e)throw new _(`EIO`,`Delegated stdin returned invalid bytes`);return{bytes:n.slice()}}case Z.Stdout:{if(m!==1&&m!==2||u.has(m))throw new _(`EBADF`,`Output descriptor is closed`);let e=d.get(m);if(e){if(!i.length){F=0;break}let t;try{t=await e.write(i.slice())}catch(e){throw xn(e)}if(typeof t!=`number`||!Number.isSafeInteger(t)||t<0||t>i.length)throw new _(`EIO`,`Delegated output returned an invalid count`);F=t;break}if(v+i.length>t.maxOutputBytes)throw new g(`RESOURCE_LIMIT`,`Live stdout/stderr exceed configured limit`);F=await(m===1?s:c).writer.write(i),v+=F;break}case Z.StdioClose:if(m!==0&&m!==1&&m!==2)throw new _(`EBADF`,`Invalid standard descriptor`);b(m);break;default:throw new _(`ENOTSUP`,`Unknown I/O operation`)}}catch(e){throw e instanceof P?new _(e.code,e.message):e}return{value:F}}}}function Cn(e){let t=e.pipeBytes??65536,n=e.maxBlockedIoMs??12e4;if(!Number.isSafeInteger(t)||t<1||t>65536||!Number.isSafeInteger(n)||n<1||n>36e5)throw new g(`INVALID_ARGUMENT`,`Invalid live channel limits`);let r=e.workerFactory,i=e.configure;return{id:e.id,filesystem:`live`,async start(e){if(e.signal.throwIfAborted(),typeof SharedArrayBuffer!=`function`||typeof globalThis.crossOriginIsolated==`boolean`&&!globalThis.crossOriginIsolated||typeof globalThis.isSecureContext==`boolean`&&!globalThis.isSecureContext)throw new g(`UNSUPPORTED_PROFILE`,`Live WASI requires a secure, cross-origin isolated browser`);let a=_n(e.generation),o=new AbortController,s,c,l=new Promise((e,t)=>{s=e,c=t});l.catch(()=>{});let u,d,f=new Promise((e,t)=>{u=e,d=t});f.catch(()=>{});let p,m=!1,h=!1,v=!1,y=!1,b,x,S,C,w,T=()=>b??=(async()=>{m=!0,o.abort();let t=[];for(let e of[()=>w?.(),()=>C?.stop(),()=>S?.dispose(),()=>x?.dispose?.()])try{e()}catch(e){t.push(e)}if(e.signal.removeEventListener(`abort`,D),c(new g(`ABORTED`,`Live worker stopped`)),d(new g(`ABORTED`,`Live worker stopped`)),p){p.onmessage=null,p.onerror=null,p.onmessageerror=null;try{await p.terminate()}catch(e){t.push(e)}}if(t.length)throw AggregateError(t,`Live worker cleanup failed`)})(),E=e=>{c(e),d(e),T().catch(()=>{})},D=()=>E(new g(`ABORTED`,`Live command cancelled`));try{x=i?.(e),S=Sn(e.fs,e.limits,t,e=>E(e),e.stdio,x?.onFileChange),C=yn(a,e.generation,(...t)=>e.fs.withMutationSource(e.mutationSource??e.generation,()=>S.dispatch(...t)));let c=vn(a,e.generation);try{w=e.fs.onGenerationChange(c),c(e.fs.generation)}catch(e){if(!(e instanceof _))throw e}if(p=r(),p.onmessage=({data:t})=>{if(!m){if(!t||t.version!==1||t.generation!==e.generation){E(new g(`STARTUP_FAILED`,`Invalid live worker generation`));return}if(t.type===`io`){C.accept(t).catch(E);return}t.type===`ready`&&!v?(v=!0,s()):t.type===`complete`&&h&&!y&&Number.isSafeInteger(t.code)&&t.code>=0&&t.code<=4294967295?(y=!0,(async()=>{await x?.complete?.(t.code,o.signal),m||u({code:t.code})})().catch(E)):t.type===`error`?E(new g(v?`STARTUP_FAILED`:`UNSUPPORTED_PROFILE`,typeof t.message==`string`?t.message.slice(0,512):`Live worker failed`)):E(new g(`STARTUP_FAILED`,`Invalid live worker response`))}},p.onerror=()=>E(new g(`STARTUP_FAILED`,`Live worker crashed`)),p.onmessageerror=()=>E(new g(`STARTUP_FAILED`,`Live worker message could not be decoded`)),e.signal.addEventListener(`abort`,D,{once:!0}),e.signal.aborted&&D(),!m){let t={type:`prepare`,version:1,generation:e.generation,command:x?.command??e.command,invocation:e.invocation,limits:e.limits,buffer:a,maxBlockedIoMs:n,openStdio:S.openStdio,configuration:x?.configuration};try{p.postMessage(t,x?.transfer??[])}catch(e){if(!(e&&typeof e==`object`&&`name`in e&&e.name===`DataCloneError`)||!x?.fallback)throw e;p.postMessage({...t,...x.fallback()})}}return await l,{stdin:S.stdin,stdout:S.stdout,stderr:S.stderr,run(){return m||h?Promise.reject(new g(`STARTUP_FAILED`,`Live worker run is single-use`)):(h=!0,p.postMessage({type:`run`,version:1,generation:e.generation}),f)},dispose:T}}catch(e){throw await T(),e}}}}function wn(e,t){let n=0,r=0,i=[/* @__PURE__ */ new Uint8Array,/* @__PURE__ */ new Uint8Array],a=[0,0];return{read(t){let r=e.subarray(n,n+t);return n+=r.length,r},write(e,n){if(r+n.length>t)throw Error(`Batch output exceeds configured limit`);let o=e-1,s=a[o],c=s+n.length;if(c>i[o].length){let e=new Uint8Array(Math.min(t,Math.max(4096,c,i[o].length*2)));e.set(i[o]),i[o]=e}return i[o].set(n,s),a[o]=c,r+=n.length,n.length},capture(){return{stdout:i[0].slice(0,a[0]),stderr:i[1].slice(0,a[1])}}}}const Tn=new TextEncoder,En=new TextDecoder(`utf-8`,{fatal:!0}),Dn={EACCES:2,EAGAIN:6,EBADF:8,EBUSY:10,EEXIST:20,EFAULT:21,EFBIG:22,EINVAL:28,EIO:29,EISDIR:31,ELOOP:32,EMFILE:33,ENOENT:44,ENOMEM:48,ENOSPC:51,ENOSYS:52,ENOTDIR:54,ENOTEMPTY:55,ENOTSUP:58,EPERM:63,EPIPE:64,EROFS:69,EXDEV:75,ENOTCAPABLE:76};var Q=class extends Error{errno;constructor(e){super(`WASI errno ${e}`),this.errno=e}},On=class{code;constructor(e){this.code=e}};const kn=e=>e===`directory`?3:e===`symlink`?7:e===`character-device`?2:4,An=(1n<<30n)-1n,jn=4n,Mn=32n,Nn=(e,t)=>((e&jn?e|Mn:e)&t)===t;function Pn(e){let t,n=e.stdio??wn(e.stdin,e.maxOutputBytes),r=/* @__PURE__ */ new Map,i=new Set([0,1,2].filter(e=>n.isOpen?.(e)??!0)),a=3;for(let[t,n]of[[`.`,e.cwd],[`/`,`/`]])r.set(a++,{fd:e.fs.open(n,{directory:!0,read:!0}),root:`/`,label:t,flags:0,rights:An,inherited:An});let o=(e,n)=>{if(e>>>=0,n>>>=0,!t||e+n>t.buffer.byteLength)throw new Q(21);return new Uint8Array(t.buffer,e,n)},s=(e,n)=>(o(e,n),new DataView(t.buffer,e>>>0,n)),c=(e,t)=>s(e,4).setUint32(0,t,!0),l=(e,t)=>{if(t>>>0>4096)throw new Q(28);try{let n=En.decode(o(e,t));if(n.includes(`\0`))throw new Q(28);return n}catch(e){throw e instanceof Q?e:new Q(28)}},u=(e,t=0n)=>{let n=r.get(e);if(!n)throw new Q(8);if(!Nn(n.rights,t))throw new Q(76);return n},d=(e,t,n,r=0n)=>{let i=u(e,r),a=l(t,n);if(a.startsWith(`/`))throw new Q(76);return{path:a,directory:i.fd,root:i.root}},f=t=>({cwd:e.fs.getDirectoryPath(t.directory),root:t.root}),p=e.fs.paths??{open(t,n,r){let i=f(t);if(!r)try{if(e.fs.lstat(t.path,i).type===`symlink`)throw new _(`ELOOP`,`Final symlink requires follow permission`)}catch(e){if(!(e instanceof _)||e.code!==`ENOENT`)throw e}return e.fs.open(t.path,{...n,...i})},stat:(t,n)=>n?e.fs.stat(t.path,f(t)):e.fs.lstat(t.path,f(t)),setTimes:(t,n,r)=>e.fs.setTimes(t.path,n,f(t),r),mkdir:t=>e.fs.mkdir(t.path,f(t)),unlink:t=>e.fs.unlink(t.path,f(t)),rmdir:t=>e.fs.rmdir(t.path,f(t)),readlink:t=>e.fs.readlink(t.path,f(t)),symlink:(t,n)=>e.fs.symlink(t,n.path,f(n)),rename(t,n){if(t.root!==n.root)throw new _(`EACCES`,`Rename requires a common root capability`);let r=f(t),i=f(n);e.fs.rename(`${r.cwd}/${t.path}`,`${i.cwd}/${n.path}`,{root:t.root,cwd:t.root})},entries(t){let n=e.fs.getDirectoryPath(t);return e.fs.readdir(n).map(t=>({name:t,stat:e.fs.lstat(`${n}/${t}`)}))}},m=(e,t)=>{if(t>>>=0,t>1024)throw new Q(28);let n=s(e,t*8);return Array.from({length:t},(e,t)=>o(n.getUint32(t*8,!0),n.getUint32(t*8+4,!0)))},h=(e,t,n)=>{let r=e.map(e=>Tn.encode(e+`\0`));o(t,r.length*4),o(n,r.reduce((e,t)=>e+t.length,0));for(let e=0;e<r.length;e++)c(t+e*4,n),o(n,r[e].length).set(r[e]),n+=r[e].length;return 0},g=(e,t,n)=>(o(t,4),o(n,4),c(t,e.length),c(n,e.reduce((e,t)=>e+Tn.encode(t).length+1,0)),0),v=Object.entries(e.env).map(([e,t])=>`${e}=${t}`),y=(e,t)=>{o(e,64).fill(0);let n=s(e,64);return n.setBigUint64(8,BigInt(t.inode),!0),n.setUint8(16,kn(t.type)),n.setBigUint64(24,1n,!0),n.setBigUint64(32,BigInt(t.size),!0),n.setBigUint64(40,BigInt(Math.trunc(t.atimeMs))*1000000n,!0),n.setBigUint64(48,BigInt(Math.trunc(t.mtimeMs))*1000000n,!0),n.setBigUint64(56,BigInt(Math.trunc(t.ctimeMs))*1000000n,!0),0},b=e=>{let t=Number(e);if(!Number.isSafeInteger(t))throw new Q(28);return t},x=(e,t,n)=>{if(n&-16||(n&3)==3||(n&12)==12)throw new Q(28);let r=e=>{if(typeof e!=`bigint`||e<-9223372036854775808n||e>18446744073709551615n)throw new Q(28);return Number(BigInt.asUintN(64,e)/1000000n)};return{...n&1?{atimeMs:r(e)}:n&2?{atimeMs:`now`}:{},...n&4?{mtimeMs:r(t)}:n&8?{mtimeMs:`now`}:{}}},S=(t,r,a,s,l)=>{o(s,4);let d=m(r,a),f=t===0&&i.has(t),p=f?void 0:u(t,2n|(l===void 0?0n:jn));if(f&&l!==void 0)throw new Q(70);let h=d.reduce((e,t)=>Math.min(1048576,e+t.length),0);if(!h)return c(s,0),0;let g=f?n.read(h):l===void 0?e.fs.read(p.fd,h):e.fs.pread(p.fd,h,b(l));if(g.length>h)throw new Q(29);let _=0;for(let e of d){let t=Math.min(e.length,g.length-_);if(e.set(g.subarray(_,_+t)),_+=t,_===g.length)break}return c(s,_),0},C=(t,r,a,s,l)=>{o(s,4);let d=m(r,a),f=0,p=(t===1||t===2)&&i.has(t),h=p?void 0:u(t,64n|(l===void 0?0n:jn));if(p&&l!==void 0)throw new Q(70);try{for(let r of d){let i=r.subarray(0,Math.min(r.length,1048576-f));if(!i.length){if(f===1048576)break;continue}if(p){let e=n.write(t,i);if(f+=e,e<i.length)break}else{let t=l===void 0?e.fs.write(h.fd,i):e.fs.pwrite(h.fd,i,b(l)+f);if(f+=t,t<i.length)break}}}catch(e){if(!f||!(e instanceof _))throw e}return c(s,f),0};return{imports:Object.fromEntries(Object.entries({args_sizes_get:(t,n)=>g(e.args,t,n),args_get:(t,n)=>h(e.args,t,n),environ_sizes_get:(e,t)=>g(v,e,t),environ_get:(e,t)=>h(v,e,t),proc_exit:e=>{throw new On(e>>>0)},fd_read:S,fd_pread:(e,t,n,r,i)=>S(e,t,n,i,r),fd_write:C,fd_pwrite:(e,t,n,r,i)=>C(e,t,n,i,r),fd_close:t=>i.delete(t)?(n.close?.(t),0):(e.fs.close(u(t).fd),r.delete(t),0),fd_seek:(t,n,r,i)=>{if(o(i,8),r<0||r>2)throw new Q(28);let a=r===1&&n===0n?Mn:jn,c=e.fs.seek(u(t,a).fd,b(n),[`set`,`cur`,`end`][r]);return s(i,8).setBigUint64(0,BigInt(c),!0),0},fd_tell:(t,n)=>(s(n,8).setBigUint64(0,BigInt(e.fs.tell(u(t,Mn).fd)),!0),0),fd_fdstat_get:(t,n)=>{o(n,24);let r=i.has(t)?void 0:u(t),a=s(n,24);return o(n,24).fill(0),a.setUint8(0,r?kn(e.fs.fstat(r.fd).type):0),a.setUint16(2,r?.flags??0,!0),a.setBigUint64(8,r?.rights??(t===0?2n:64n),!0),a.setBigUint64(16,r?.inherited??0n,!0),0},fd_fdstat_set_rights:(e,t,n)=>{let r=u(e);return!Nn(r.rights,t)||!Nn(r.inherited,n)?76:(r.rights=t,r.inherited=n,0)},fd_fdstat_set_flags:(e,t)=>{if(i.has(e))return t===0?0:58;let n=u(e,8n);return t&-6||(t&1)!=(n.flags&1)?58:(n.flags=t,0)},fd_filestat_get:(t,n)=>i.has(t)?(o(n,64).fill(0),0):y(n,e.fs.fstat(u(t,1n<<21n).fd)),fd_filestat_set_size:(t,n)=>{let r=u(t,1n<<22n);return e.fs.ftruncate(r.fd,b(n)),0},fd_filestat_set_times:(t,n,r,i)=>{let a=x(n,r,i),o=u(t,1n<<23n);return e.fs.fsetTimes(o.fd,a),0},fd_prestat_get:(e,t)=>{let n=u(e);return n.label===void 0?8:(o(t,8).fill(0),c(t+4,Tn.encode(n.label).length),0)},fd_prestat_dir_name:(e,t,n)=>{let r=u(e);if(r.label===void 0)return 8;let i=Tn.encode(r.label);return n>>>0<i.length?37:(o(t,i.length).set(i),0)},path_open:(e,t,n,a,s,l,f,m,h)=>{if(o(h,4),t&-2||s&-16||m&-6)return 58;let g=u(e,1n<<13n);if(!Nn(g.inherited,l)||!Nn(g.inherited,f)||s&1&&!(g.rights&1n<<10n)||s&8&&(!(g.rights&1n<<19n)||!(l&64n)))return 76;let _=d(e,n,a),v=0;for(;r.has(v)||i.has(v);)v++;if(v>=256)return 33;let y=!!(l&64n),b=!!(l&1n<<22n),x=p.open(_,{read:!!(l&2n)||!(y||b),write:y,resize:b,create:!!(s&1),directory:!!(s&2),exclusive:!!(s&4),truncate:!!(s&8),append:!!(m&1)},!!(t&1));return r.set(v,{fd:x,root:g.root,flags:m,rights:l,inherited:f}),c(h,v),0},path_filestat_get:(e,t,n,r,i)=>{if(o(i,64),t&-2)return 28;let a=d(e,n,r,1n<<18n);return y(i,p.stat(a,!!(t&1)))},path_filestat_set_times:(e,t,n,r,i,a,o)=>{if(t&-2)return 28;let s=x(i,a,o),c=d(e,n,r,1n<<20n);return p.setTimes(c,s,!!(t&1)),0},path_create_directory:(e,t,n)=>{let r=d(e,t,n,1n<<9n);return p.mkdir(r),0},path_unlink_file:(e,t,n)=>{let r=d(e,t,n,1n<<26n);return p.unlink(r),0},path_remove_directory:(e,t,n)=>{let r=d(e,t,n,1n<<25n);return p.rmdir(r),0},path_readlink:(e,t,n,r,i,a)=>{o(a,4),o(r,i);let s=d(e,t,n,1n<<15n),l=Tn.encode(p.readlink(s)).subarray(0,i>>>0);return o(r,l.length).set(l),c(a,l.length),0},path_symlink:(e,t,n,r,i)=>{let a=l(e,t),o=d(n,r,i,1n<<24n);return p.symlink(a,o),0},path_rename:(e,t,n,r,i,a)=>{let o=d(e,t,n,1n<<16n),s=d(r,i,a,1n<<17n);return p.rename(o,s),0},fd_readdir:(e,t,n,r,i)=>{let a=u(e,1n<<14n);o(i,4);let s=o(t,n),l=0,d=b(r);if(d<0)return 28;if(!s.length)return c(i,0),0;(d===0||!a.entries)&&(a.entries=p.entries(a.fd));let f=a.entries;for(let e=d;e<f.length&&l<s.length;e++){let{name:t,stat:n}=f[e],r=Tn.encode(t),i=new Uint8Array(24+r.length),a=new DataView(i.buffer);a.setBigUint64(0,BigInt(e+1),!0),a.setBigUint64(8,BigInt(n.inode),!0),a.setUint32(16,r.length,!0),a.setUint8(20,kn(n.type)),i.set(r,24);let o=Math.min(i.length,s.length-l);s.set(i.subarray(0,o),l),l+=o}return c(i,l),0},random_get:(e,t)=>{let n=o(e,t);for(let e=0;e<n.length;e+=65536)crypto.getRandomValues(n.subarray(e,e+65536));return 0},clock_time_get:(e,t,n)=>{if(e!==0&&e!==1)return 28;let r=e===0?Date.now():performance.now();return s(n,8).setBigUint64(0,BigInt(Math.trunc(r*1e6)),!0),0},clock_res_get:(e,t)=>e!==0&&e!==1?28:(s(t,8).setBigUint64(0,1000000n,!0),0),sched_yield:()=>0,poll_oneoff:()=>52,fd_sync:()=>58,fd_datasync:()=>58,path_link:()=>58,proc_raise:()=>58}).map(([e,t])=>[e,(...e)=>{try{return t(...e)}catch(e){if(e instanceof Q)return e.errno;if(e instanceof _)return Dn[e.code]??29;throw e}}])),filesystemImports:Object.fromEntries(Object.entries({path_mode(e,t,n,r){if(r&-2)throw new Q(28);return p.stat(d(e,t,n,1n<<18n),!!(r&1)).mode},fd_mode(t){return e.fs.fstat(u(t,1n<<21n).fd).mode}}).map(([e,t])=>[e,(...e)=>{try{return t(...e)}catch(e){if(e instanceof Q)return-e.errno;if(e instanceof _)return-(Dn[e.code]??29);throw e}}])),processImports:{initial_cwd(t,n){let r=Tn.encode(e.cwd+`\0`);try{return n>>>0<r.length?-1:(o(t,n).subarray(0,r.length).set(r),r.length)}catch(e){if(e instanceof Q)return-1;throw e}}},run(e){t=e.exports.memory;let r=0;try{e.exports._start()}catch(e){if(e instanceof On)r=e.code;else throw e}return{code:r,...n.capture()}},dispose(){for(let t of r.values())e.fs.close(t.fd);r.clear()}}}function Fn(e,t){let n=e=>{throw new g(`UNSUPPORTED_PROFILE`,e)};(!Number.isSafeInteger(t)||t<65536||t>2**32)&&n(`Invalid memory limit`),(e.length<8||![0,97,115,109,1,0,0,0].every((t,n)=>e[n]===t))&&n(`Expected core Wasm v1`);let r=8,i=e.length,a=0,o=()=>{let t=0;for(let a=0;a<35;a+=7){r>=i&&n(`Truncated Wasm section`);let o=e[r++];if(a===28&&o>15&&n(`Invalid Wasm integer`),t+=(o&127)*2**a,!(o&128))return t}return n(`Invalid Wasm integer`)};for(;r<e.length;){let s=e[r++];i=e.length;let c=o(),l=r+c;if(l>e.length&&n(`Truncated Wasm section`),i=l,s===8&&n(`Wasm start sections are outside the command profile`),s===5){(o()!==1||o()!==1)&&n(`Require one bounded, unshared wasm32 memory`);let e=o(),s=o();(e>s||s*65536>t||r!==i)&&n(`Wasm memory exceeds the hard limit`),a++}r=l}a!==1&&n(`Require exactly one defined memory`)}function In(e,t){let n=WebAssembly.Module.imports(e),r=WebAssembly.Module.exports(e);return n.some(e=>e.module===`wasm_idle_process_v1`&&e.name===`initial_cwd`)&&n.every(e=>e.kind===`function`&&(e.module===`wasi_snapshot_preview1`&&t.has(e.name)||e.module===`wasm_idle_process_v1`&&e.name===`initial_cwd`))&&r.some(e=>e.name===`memory`&&e.kind===`memory`)&&r.some(e=>e.name===`_start`&&e.kind===`function`)}function Ln(e,t=e.maxInodes,n){if(!Number.isSafeInteger(t)||t<1)throw RangeError(`Invalid compiler output tracking limit`);let r=/* @__PURE__ */ new Map,i=!1,a=!1;return{record(e,n,o){if(i||a)return;let s=r.get(n.inode);if(e!==`rename`||s){if(!s&&r.size>=t){a=!0,r.clear();return}r.set(n.inode,{version:n,conflicted:!(!s||!s.conflicted&&s.version===o)})}},async qualify(t,o,s,c){if(!(t!==0||a))for(let{version:t,conflicted:a}of r.values()){if(i||c.aborted)return;if(a)continue;let r=e.readFileVersion(t);if(r?.path.startsWith(`/workspace/`)&&[0,97,115,109,1,0,0,0].every((e,t)=>r.bytes[t]===e))try{Fn(r.bytes,s);let a=await WebAssembly.compile(r.bytes);if(i||c.aborted)return;In(a,o)&&e.withMutationSource(n,()=>e.grantExecutable(t))}catch{}}},dispose(){i=!0,r.clear()}}}function Rn(e){let t=dn(e),n=e.moduleServices??e.workerFactory===void 0;if(typeof n!=`boolean`)throw new g(`INVALID_ARGUMENT`,`moduleServices must be boolean`);let r=e.moduleCacheBytes??268435456,i=new re(r,2),a=0,o=/* @__PURE__ */ new Set,s=e=>new Promise((t,n)=>{let r=()=>{o.delete(i),e.removeEventListener(`abort`,r),n(e.reason)},i=()=>{if(o.delete(i),e.removeEventListener(`abort`,r),e.aborted){n(e.reason);return}a++;let s=!1;t(()=>{if(!s)for(s=!0,a--;a<2&&o.size;)o.values().next().value()})};if(e.aborted){n(e.reason);return}a<2?i():(o.add(i),e.addEventListener(`abort`,r,{once:!0}),e.aborted&&r())}),c=!1;return{...Cn({id:`llvm-clang-tool-host-live-v1`,pipeBytes:e.pipeBytes,maxBlockedIoMs:e.maxBlockedIoMs,workerFactory:e.workerFactory??(()=>new Worker(new URL(
/* @vite-ignore */
new URL(`worker-DQCqgUbZ.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`wasm-idle-live-clang`})),configure(e){if(c)throw new g(`RESOURCE_LIMIT`,`One live LLVM command may use this adapter at a time`);let r=e.fs;for(let e of[t.linkerPath,...t.compilerPaths]){let t=r.stat(e);if(!r.isReadonly(e)||t.type!==`file`||!(t.mode&73)||t.command)throw new g(`INVALID_ARGUMENT`,`LLVM paths must name actual readonly executable files`)}let a=r.readFile(t.linkerPath),o=Pn({...e.invocation,args:[],fs:r,stdin:/* @__PURE__ */ new Uint8Array,maxOutputBytes:0}),l=new Set(Object.keys(o.imports));o.dispose();let u=Ln(r,e.limits.maxWorkspaceInodes,e.mutationSource??e.generation),d=JSON.stringify([`container-live-llvm-v1`,e.limits.maxMemoryBytes,e.invocation.cwd!==`/`]),f=`native-default-v1`,p=Math.max(e.limits.maxWorkspaceBytes,e.command.bytes.length,a.length),m={},h=[];try{for(let[r,o,c]of[[`clang`,e.command.bytes,t.clangSha256],[`wasm-ld`,a,t.linkerSha256]]){if(Fn(o,e.limits.maxMemoryBytes),!n)continue;let t=ue({bytes:o,receipt:{bytes:o.length,sha256:c},cache:i,identity:`${d}:${r}`,compileKey:f,maxAssetBytes:p,signal:e.signal,acquireVerificationSlot:s,async compile(t,n=e.signal){Fn(t,e.limits.maxMemoryBytes);let r=await s(n);try{return n.throwIfAborted(),await WebAssembly.compile(t)}finally{r()}}});h.push(t),m[r]={port:t.port,bytes:o.length,sha256:c,identity:`${d}:${r}`,compileKey:f,maxAssetBytes:p}}}catch(e){for(let e of h)e.close();throw u.dispose(),e}return c=!0,{configuration:n?{...t,services:m}:{...t,linker:a},...n?{command:{adapter:e.command.adapter,argv0:e.command.argv0},transfer:h.map(e=>e.port),fallback(){for(let e of h)e.close();return{command:e.command,configuration:{...t,linker:a}}}}:{},onFileChange:u.record,complete:(n,r)=>t.executableOutputProfile===`wasi-preview1-process`?u.qualify(n,l,e.limits.maxMemoryBytes,r):void 0,dispose(){for(let e of h)e.close();u.dispose(),c=!1}}}}),clearModuleCache(){i.dispose(),i=new re(r,2)}}}function zn(e={}){return Cn({...e,id:`wasi-preview1-live`,workerFactory:e.workerFactory??(()=>new Worker(new URL(
/* @vite-ignore */
new URL(`worker-BLVSYHch.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`wasm-idle-live-command`}))})}Object.freeze({name:`emscripten`,version:`6.0.0`,revision:`afa15e0c56d1292e073c2c91bafc1d5e0cdf0dd3`}),Object.freeze({name:`clang`,version:`22.1.8`,revision:`ca7933e47d3a3451d81e72ac174dcb5aa28b59d1`});const Bn=Object.freeze([`-D__SSE__=1`,`-D__SSE2__=1`,`-D__SSE3__=1`,`-D__SSSE3__=1`,`-D__SSE4_1__=1`,`-D__SSE4_2__=1`,`-D__AVX__=1`,`-D__AVX2__=1`]),Vn=Object.freeze({"immintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_immintrin_h__
#define __emscripten_immintrin_h__

#ifdef __SSE__
#include <xmmintrin.h>
#endif

#ifdef __SSE2__
#include <emmintrin.h>
#endif

#ifdef __SSE3__
#include <pmmintrin.h>
#endif

#ifdef __SSSE3__
#include <tmmintrin.h>
#endif

#ifdef __SSE4_1__
#include <smmintrin.h>
#endif

#ifdef __SSE4_2__
#include <nmmintrin.h>
#endif

#ifdef __AVX__
#include <avxintrin.h>
#endif

#ifdef __AVX2__
#include <avx2intrin.h>
#endif

#endif /* __emscripten_immintrin_h__ */
`,"xmmintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_xmmintrin_h__
#define __emscripten_xmmintrin_h__

#include <wasm_simd128.h>

#include <limits.h>
#include <math.h>
#include <string.h>

#ifndef __SSE__
#error "SSE instruction set not enabled"
#endif

#ifdef WASM_SIMD_COMPAT_SLOW
#define DIAGNOSE_SLOW diagnose_if(1, "Instruction emulated via slow path.", "warning")
#else
#define DIAGNOSE_SLOW
#endif

// Emscripten SIMD support doesn't support MMX/float32x2/__m64.
// However, we support loading and storing 2-vectors, so
// recognize the type at least.
typedef float __m64 __attribute__((__vector_size__(8), __aligned__(8)));
typedef __f32x4 __m128;
typedef v128_t __m128i;

#define __f32x4_shuffle(__a, __b, __c0, __c1, __c2, __c3)                   \\
  ((v128_t)(__builtin_shufflevector((__f32x4)(__a), (__f32x4)(__b), __c0,   \\
                                    __c1, __c2, __c3)))

// This is defined as a macro because __builtin_shufflevector requires its
// mask argument to be a compile-time constant.
#define _mm_shuffle_ps(__a, __b, __mask) __extension__ ({ \\
  ((__m128)__f32x4_shuffle(__a, __b, \\
                           (((__mask) >> 0) & 0x3) + 0, \\
                           (((__mask) >> 2) & 0x3) + 0, \\
                           (((__mask) >> 4) & 0x3) + 4, \\
                           (((__mask) >> 6) & 0x3) + 4)); })

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_set_ps(float __z, float __y, float __x, float __w)
{
  return (__m128)wasm_f32x4_make(__w, __x, __y, __z);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_setr_ps(float __z, float __y, float __x, float __w)
{
  return (__m128)wasm_f32x4_make(__z, __y, __x, __w);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_set_ss(float __w)
{
  return (__m128)wasm_f32x4_make(__w, 0, 0, 0);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_set_ps1(float __w)
{
  return (__m128)wasm_f32x4_splat(__w);
}

#define _mm_set1_ps _mm_set_ps1

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_setzero_ps(void)
{
  return (__m128)wasm_f32x4_const(0.f, 0.f, 0.f, 0.f);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_load_ps(const float *__p)
{
  return *(__m128*)__p;
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_loadl_pi(__m128 __a, const void /*__m64*/ *__p)
{
  return (__m128)wasm_v128_load64_lane(__p, (v128_t)__a, 0);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_loadh_pi(__m128 __a, const void /*__m64*/ *__p)
{
  return (__m128)wasm_v128_load64_lane(__p, (v128_t)__a, 1);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_loadr_ps(const float *__p)
{
  __m128 __v = _mm_load_ps(__p);
  return (__m128)__f32x4_shuffle(__v, __v, 3, 2, 1, 0);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_loadu_ps(const float *__p)
{
  return (__m128)wasm_v128_load(__p);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_load_ps1(const float *__p)
{
  return (__m128)wasm_v32x4_load_splat(__p);
}
#define _mm_load1_ps _mm_load_ps1

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_load_ss(const float *__p)
{
  return (__m128)wasm_v128_load32_zero(__p);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_storel_pi(__m64 *__p, __m128 __a)
{
  wasm_v128_store64_lane((void*)__p, (v128_t)__a, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_storeh_pi(__m64 *__p, __m128 __a)
{
  wasm_v128_store64_lane((void*)__p, (v128_t)__a, 1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store_ps(float *__p, __m128 __a)
{
  *(__m128 *)__p = __a;
}
// No NTA cache hint available.
#define _mm_stream_ps _mm_store_ps

#define _MM_HINT_T0 3
#define _MM_HINT_T1 2
#define _MM_HINT_T2 1
#define _MM_HINT_NTA 0
// No prefetch available, dummy it out.
static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_prefetch(const void *__p, int __i)
{
  ((void)__p);
  ((void)__i);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_sfence(void)
{
  // Wasm/SharedArrayBuffer memory model is sequentially consistent.
  // Perhaps a future version of the spec can provide a related fence.
  __sync_synchronize();
}

#define _MM_SHUFFLE(w, z, y, x) (((w) << 6) | ((z) << 4) | ((y) << 2) | (x))

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storer_ps(float *__p, __m128 __a)
{
  _mm_store_ps(__p, _mm_shuffle_ps(__a, __a, _MM_SHUFFLE(0, 1, 2, 3)));
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store_ps1(float *__p, __m128 __a)
{
  _mm_store_ps(__p, _mm_shuffle_ps(__a, __a, _MM_SHUFFLE(0, 0, 0, 0)));
}
#define _mm_store1_ps _mm_store_ps1

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store_ss(float *__p, __m128 __a)
{
  wasm_v128_store32_lane((void*)__p, (v128_t)__a, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeu_ps(float *__p, __m128 __a)
{
  struct __unaligned {
    __m128 __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __unaligned *)__p)->__v = __a;
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_movemask_ps(__m128 __a)
{
  return (int)wasm_i32x4_bitmask((v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_move_ss(__m128 __a, __m128 __b)
{
  return (__m128)__f32x4_shuffle(__a, __b, 4, 1, 2, 3);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_add_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_add((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_add_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_add_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_sub_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_sub((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_sub_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_sub_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_mul_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_mul((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_mul_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_mul_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_div_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_div((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_div_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_div_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_min_ps(__m128 __a, __m128 __b)
{
//  return (__m128)wasm_f32x4_pmin((v128_t)__a, (v128_t)__b); // TODO: Migrate to this, once it works in VMs
  return (__m128)wasm_v128_bitselect((v128_t)__a, (v128_t)__b, (v128_t)wasm_f32x4_lt((v128_t)__a, (v128_t)__b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_min_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_min_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_max_ps(__m128 __a, __m128 __b)
{
//  return (__m128)wasm_f32x4_pmax((v128_t)__a, (v128_t)__b); // TODO: Migrate to this, once it works in VMs
  return (__m128)wasm_v128_bitselect((v128_t)__a, (v128_t)__b, (v128_t)wasm_f32x4_gt((v128_t)__a, (v128_t)__b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_max_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_max_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_rcp_ps(__m128 __a)
{
    return (__m128)wasm_f32x4_div((v128_t)_mm_set1_ps(1.0f), (v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_rcp_ss(__m128 __a)
{
  return _mm_move_ss(__a, _mm_rcp_ps(__a));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_sqrt_ps(__m128 __a)
{
  return (__m128)wasm_f32x4_sqrt((v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_sqrt_ss(__m128 __a)
{
  return _mm_move_ss(__a, _mm_sqrt_ps(__a));
}

#define _mm_rsqrt_ps(__a) _mm_rcp_ps(_mm_sqrt_ps((__a)))

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_rsqrt_ss(__m128 __a)
{
  return _mm_move_ss(__a, _mm_rsqrt_ps(__a));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_unpackhi_ps(__m128 __a, __m128 __b)
{
  return (__m128)__f32x4_shuffle(__a, __b, 2, 6, 3, 7);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_unpacklo_ps(__m128 __a, __m128 __b)
{
  return (__m128)__f32x4_shuffle(__a, __b, 0, 4, 1, 5);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_movehl_ps(__m128 __a, __m128 __b)
{
  return (__m128)__f32x4_shuffle(__a, __b, 6, 7, 2, 3);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_movelh_ps(__m128 __a, __m128 __b)
{
  return (__m128)__f32x4_shuffle(__a, __b, 0, 1, 4, 5);
}

#define _MM_TRANSPOSE4_PS(row0, row1, row2, row3) \\
  do { \\
    __m128 __row0 = (row0); \\
    __m128 __row1 = (row1); \\
    __m128 __row2 = (row2); \\
    __m128 __row3 = (row3); \\
    __m128 __tmp0 = _mm_unpacklo_ps(__row0, __row1); \\
    __m128 __tmp1 = _mm_unpackhi_ps(__row0, __row1); \\
    __m128 __tmp2 = _mm_unpacklo_ps(__row2, __row3); \\
    __m128 __tmp3 = _mm_unpackhi_ps(__row2, __row3); \\
    (row0) = _mm_movelh_ps(__tmp0, __tmp2); \\
    (row1) = _mm_movehl_ps(__tmp2, __tmp0); \\
    (row2) = _mm_movelh_ps(__tmp1, __tmp3); \\
    (row3) = _mm_movehl_ps(__tmp3, __tmp1); \\
  } while (0)

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_lt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmplt_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmple_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_le((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmple_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmple_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_eq((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpeq_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpge_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_ge((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpge_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpge_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_gt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpgt_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW)) _mm_cmpord_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_and(wasm_f32x4_eq((v128_t)__a, (v128_t)__a),
                               wasm_f32x4_eq((v128_t)__b, (v128_t)__b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW)) _mm_cmpord_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpord_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW)) _mm_cmpunord_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_or(wasm_f32x4_ne((v128_t)__a, (v128_t)__a),
                              wasm_f32x4_ne((v128_t)__b, (v128_t)__b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW)) _mm_cmpunord_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpunord_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_and_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_and((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_andnot_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_andnot((v128_t)__b, (v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_or_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_or((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_xor_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_xor((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpneq_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_f32x4_ne((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpneq_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpneq_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpnge_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_not((v128_t)_mm_cmpge_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpnge_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpnge_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpngt_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_not((v128_t)_mm_cmpgt_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpngt_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpngt_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpnle_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_not((v128_t)_mm_cmple_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpnle_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpnle_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpnlt_ps(__m128 __a, __m128 __b)
{
  return (__m128)wasm_v128_not((v128_t)_mm_cmplt_ps(__a, __b));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cmpnlt_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_cmpnlt_ps(__a, __b));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_comieq_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) == wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_comige_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) >= wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_comigt_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) > wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_comile_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) <= wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_comilt_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) < wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_comineq_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) != wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_ucomieq_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) == wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_ucomige_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) >= wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_ucomigt_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) > wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_ucomile_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) <= wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_ucomilt_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) < wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_ucomineq_ss(__m128 __a, __m128 __b)
{
  return wasm_f32x4_extract_lane((v128_t)__a, 0) != wasm_f32x4_extract_lane((v128_t)__b, 0);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_cvtsi32_ss(__m128 __a, int __b)
{
  __f32x4 __v = (__f32x4)__a;
  __v[0] = (float)__b;
  return (__m128)__v;
}
#define _mm_cvt_si2ss _mm_cvtsi32_ss

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW)) _mm_cvtss_si32(__m128 __a)
{
  float e = ((__f32x4)__a)[0];
  if (e < 2147483648.0f && e >= -2147483648.0f && (lrint(e) != 0 || fabsf(e) < 2.f))
    return lrint(e);
  else
    return (int)0x80000000;
}
#define _mm_cvt_ss2si _mm_cvtss_si32

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW)) _mm_cvttss_si32(__m128 __a)
{
  float e = ((__f32x4)__a)[0];
  if (e < 2147483648.0f && e >= -2147483648.0f && (lrint(e) != 0 || fabsf(e) < 2.f))
    return (int)e;
  else
    return (int)0x80000000;
}
#define _mm_cvtt_ss2si _mm_cvttss_si32

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_cvtsi64_ss(__m128 __a, long long __b)
{
  __f32x4 __v = (__f32x4)__a;
  __v[0] = (float)__b;
  return (__m128)__v;
}

static __inline__ long long __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_cvtss_si64(__m128 __a)
{
  float e = ((__f32x4)__a)[0];
  long long x = llrintf(e);
  if (e <= LLONG_MAX && e >= LLONG_MIN && (x != 0 || fabsf(e) < 2.f))
    return x;
  else
    return 0x8000000000000000LL;
}

static __inline__ long long __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_cvttss_si64(__m128 __a)
{
  float e = ((__f32x4)__a)[0];
  long long x = llrintf(e);
  if (e <= LLONG_MAX && e >= LLONG_MIN && (x != 0 || fabsf(e) < 2.f))
    return (long long)e;
  else
    return 0x8000000000000000LL;
}

static __inline__ float __attribute__((__always_inline__, __nodebug__))
_mm_cvtss_f32(__m128 __a)
{
  return (float)((__f32x4)__a)[0];
}

#define _mm_malloc(__size, __align) memalign((__align), (__size))
#define _mm_free free

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_undefined()
{
  __m128 val;
  return val;
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_undefined_ps()
{
  __m128 val;
  return val;
}

#define _MM_EXCEPT_MASK       0x003f
#define _MM_EXCEPT_INVALID    0x0001
#define _MM_EXCEPT_DENORM     0x0002
#define _MM_EXCEPT_DIV_ZERO   0x0004
#define _MM_EXCEPT_OVERFLOW   0x0008
#define _MM_EXCEPT_UNDERFLOW  0x0010
#define _MM_EXCEPT_INEXACT    0x0020

#define _MM_MASK_MASK         0x1f80
#define _MM_MASK_INVALID      0x0080
#define _MM_MASK_DENORM       0x0100
#define _MM_MASK_DIV_ZERO     0x0200
#define _MM_MASK_OVERFLOW     0x0400
#define _MM_MASK_UNDERFLOW    0x0800
#define _MM_MASK_INEXACT      0x1000

#define _MM_ROUND_MASK        0x6000
#define _MM_ROUND_NEAREST     0x0000
#define _MM_ROUND_DOWN        0x2000
#define _MM_ROUND_UP          0x4000
#define _MM_ROUND_TOWARD_ZERO 0x6000

#define _MM_FLUSH_ZERO_MASK   0x8000
#define _MM_FLUSH_ZERO_ON     0x8000
#define _MM_FLUSH_ZERO_OFF    0x0000

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_getcsr()
{
  return _MM_MASK_INEXACT | _MM_MASK_DENORM | _MM_MASK_DIV_ZERO | _MM_MASK_OVERFLOW | _MM_MASK_UNDERFLOW | _MM_MASK_INVALID
    | _MM_ROUND_NEAREST | _MM_FLUSH_ZERO_OFF;
}

#define _MM_GET_EXCEPTION_STATE() (_mm_getcsr() & _MM_EXCEPT_MASK)
#define _MM_GET_EXCEPTION_MASK() (_mm_getcsr() & _MM_MASK_MASK)
#define _MM_GET_ROUNDING_MODE() (_mm_getcsr() & _MM_ROUND_MASK)
#define _MM_GET_FLUSH_ZERO_MODE() (_mm_getcsr() & _MM_FLUSH_ZERO_MASK)

// Unavailable functions:
// void _MM_SET_EXCEPTION_STATE(unsigned int __a);
// void _MM_SET_EXCEPTION_MASK(unsigned int __a);
// void _MM_GET_ROUNDING_MODE(unsigned int __a);
// void _MM_GET_FLUSH_ZERO_MODE(unsigned int __a);

#endif /* __emscripten_xmmintrin_h__ */
`,"emmintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_emmintrin_h__
#define __emscripten_emmintrin_h__

#ifndef __SSE2__
#error "SSE2 instruction set not enabled"
#endif

#include <xmmintrin.h>

// Alias different (functionally) equivalent intrinsics.
#define _mm_set_epi64x _mm_set_epi64
#define _mm_cvtsd_si64x _mm_cvtsd_si64
#define _mm_cvtsi128_si64x _mm_cvtsi128_si64
#define _mm_cvtsi64x_sd _mm_cvtsi64_sd
#define _mm_cvtsi64x_si128 _mm_cvtsi64_si128
#define _mm_cvttsd_si64x _mm_cvttsd_si64
#define _mm_store_pd1 _mm_store1_pd

typedef __f64x2 __m128d;

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_move_sd(__m128d __a, __m128d __b)
{
  return (__m128d){ __b[0], __a[1] };
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_add_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_add((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_add_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_add_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_sub_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_sub((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_sub_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_sub_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_mul_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_mul((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_mul_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_mul_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_div_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_div((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_div_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_div_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_sqrt_pd(__m128d __a)
{
  return (__m128d)wasm_f64x2_sqrt((v128_t)__a);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_sqrt_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_sqrt_pd(__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_min_pd(__m128d __a, __m128d __b)
{
//  return (__m128d)wasm_f32x4_pmin((v128_t)__a, (v128_t)__b); // TODO: Migrate to this, once it works in VMs
  return (__m128d)wasm_v128_bitselect((v128_t)__a, (v128_t)__b, (v128_t)wasm_f64x2_lt((v128_t)__a, (v128_t)__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_min_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_min_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_max_pd(__m128d __a, __m128d __b)
{
//  return (__m128)wasm_f32x4_pmax((v128_t)__a, (v128_t)__b); // TODO: Migrate to this, once it works in VMs
  return (__m128d)wasm_v128_bitselect((v128_t)__a, (v128_t)__b, (v128_t)wasm_f64x2_gt((v128_t)__a, (v128_t)__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_max_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_max_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_and_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_and((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_andnot_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_andnot((v128_t)__b, (v128_t)__a);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_or_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_or((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_xor_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_xor((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_eq((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_lt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmple_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_le((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_gt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpge_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_ge((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpord_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_and(wasm_f64x2_eq((v128_t)__a, (v128_t)__a),
                                wasm_f64x2_eq((v128_t)__b, (v128_t)__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpunord_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_or(wasm_f64x2_ne((v128_t)__a, (v128_t)__a),
                               wasm_f64x2_ne((v128_t)__b, (v128_t)__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpneq_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_f64x2_ne((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpnlt_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_not((v128_t)_mm_cmplt_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpnle_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_not((v128_t)_mm_cmple_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpngt_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_not((v128_t)_mm_cmpgt_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpnge_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_v128_not((v128_t)_mm_cmpge_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpeq_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmplt_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmple_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmple_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpgt_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpge_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpge_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpord_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpord_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpunord_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpunord_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpneq_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpneq_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpnlt_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpnlt_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpnle_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpnle_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpngt_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpngt_pd(__a, __b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cmpnge_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_cmpnge_pd(__a, __b));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_comieq_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) == wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_comilt_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) < wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_comile_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) <= wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_comigt_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) > wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_comige_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) >= wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_comineq_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) != wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_ucomieq_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) == wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_ucomilt_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) < wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_ucomile_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) <= wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_ucomigt_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) > wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_ucomige_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) >= wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_ucomineq_sd(__m128d __a, __m128d __b)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0) != wasm_f64x2_extract_lane((v128_t)__b, 0);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cvtpd_ps(__m128d __a)
{
  return (__m128)wasm_f32x4_demote_f64x2_zero((v128_t)__a);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cvtps_pd(__m128 __a)
{
  return (__m128d)wasm_f64x2_promote_low_f32x4((v128_t)__a);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi32_pd(__m128i __a)
{
  return (__m128d)wasm_f64x2_convert_low_i32x4((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtpd_epi32(__m128d __a)
{
  // TODO: OPTIMIZE!
  int m[2];
  for(int i = 0; i < 2; ++i)
  {
    double e = __a[i];
    int x = lrint(e);
    if (e <= INT_MAX && e >= INT_MIN && (x != 0 || fabs(e) < 2.0))
      m[i] = x;
    else
      m[i] = (int)0x80000000;
  }
  return wasm_i32x4_make(m[0], m[1], 0, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_cvtsd_si32(__m128d __a)
{
  // TODO: OPTIMIZE!
  double e = __a[0];
  int x = lrint(e);
  if (e <= INT_MAX && e >= INT_MIN && (x != 0 || fabs(e) < 2.0))
    return x;
  else
    return (int)0x80000000;
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cvtsd_ss(__m128 __a, __m128d __b)
{
  __a[0] = __b[0];
  return __a;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cvtsi32_sd(__m128d __a, int __b)
{
  __a[0] = __b;
  return __a;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cvtss_sd(__m128d __a, __m128 __b)
{
  __a[0] = __b[0];
  return __a;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvttpd_epi32(__m128d __a)
{
  // TODO: OPTIMIZE!
  int m[2];
  for(int i = 0; i < 2; ++i)
  {
    double elem = __a[i];
    if (elem < 2147483648.0 && elem >= -2147483648.0 && (lrint(elem) != 0 || fabs(elem) < 2.0))
      // Use the trapping instruction here since we have explicit bounds checks
      // above.
      m[i] = __builtin_wasm_trunc_s_i32_f64(elem);
    else
      m[i] = (int)0x80000000;
  }
  return wasm_i32x4_make(m[0], m[1], 0, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_cvttsd_si32(__m128d __a)
{
  // TODO: OPTIMIZE!
  double elem = __a[0];
  if (elem < 2147483648.0 && elem >= -2147483648.0 && (lrint(elem) != 0 || fabs(elem) < 2.0))
    // Use the trapping instruction here since we have explicit bounds checks
    // above.
    return __builtin_wasm_trunc_s_i32_f64(elem);
  else
    return (int)0x80000000;
}

static __inline__ double __attribute__((__always_inline__, __nodebug__))
_mm_cvtsd_f64(__m128d __a)
{
  return wasm_f64x2_extract_lane((v128_t)__a, 0);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_load_pd(double const *__dp)
{
  return *(__m128d*)__dp;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_load1_pd(double const *__dp)
{
  return (__m128d)wasm_v64x2_load_splat(__dp);
}

#define        _mm_load_pd1(dp)        _mm_load1_pd(dp)

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_loadr_pd(double const *__p)
{
  __m128d __u = *(__m128d*)__p; // aligned load
  return (__m128d)wasm_i64x2_shuffle((v128_t)__u, (v128_t)__u, 1, 0);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_loadu_pd(double const *__dp)
{
  struct __loadu_pd {
    __m128d __v;
  } __attribute__((__packed__, __may_alias__));
  return ((struct __loadu_pd*)__dp)->__v;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_load_sd(double const *__p)
{
  return (__m128d)wasm_v128_load64_zero((const void*)__p);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_loadh_pd(__m128d __a, double const *__dp)
{
  return (__m128d)wasm_v128_load64_lane((const void*)__dp, (v128_t)__a, 1);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_loadl_pd(__m128d __a, double const *__dp)
{
  return (__m128d)wasm_v128_load64_lane((const void*)__dp, (v128_t)__a, 0);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_set_sd(double __w)
{
  return (__m128d)wasm_f64x2_make(__w, 0);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_set1_pd(double __w)
{
  return (__m128d)wasm_f64x2_splat(__w);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_set_pd(double __c1, double __c0)
{
  return (__m128d)wasm_f64x2_make(__c0, __c1);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_setr_pd(double __c0, double __c1)
{
  return (__m128d)wasm_f64x2_make(__c0, __c1);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_setzero_pd(void)
{
  return (__m128d)wasm_f64x2_const(0.0, 0.0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store_sd(double *__dp, __m128d __a)
{
  wasm_v128_store64_lane((void*)__dp, (v128_t)__a, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store1_pd(double *__dp, __m128d __a)
{
  struct __mm_store1_pd_struct {
    double __u[2];
  } __attribute__((__packed__, __may_alias__));
  ((struct __mm_store1_pd_struct*)__dp)->__u[0] = __a[0];
  ((struct __mm_store1_pd_struct*)__dp)->__u[1] = __a[0];
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store_pd(double *__dp, __m128d __a)
{
  *(__m128d *)__dp = __a;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeu_pd(double *__dp, __m128d __a)
{
  struct __unaligned {
    __m128d __v;
  } __attribute__((__packed__, __may_alias__));

  ((struct __unaligned *)__dp)->__v = __a;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storer_pd(double *__p, __m128d __a)
{
  *(__m128d *)__p = (__m128d)wasm_i64x2_shuffle((v128_t)__a, (v128_t)__a, 1, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeh_pd(double *__dp, __m128d __a)
{
  wasm_v128_store64_lane((void*)__dp, (v128_t)__a, 1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storel_pd(double *__dp, __m128d __a)
{
  wasm_v128_store64_lane((void*)__dp, (v128_t)__a, 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_add_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_add((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_add_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_add((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_add_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_add((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_add_epi64(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i64x2_add((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_adds_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_add_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_adds_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_add_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_adds_epu8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u8x16_add_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_adds_epu16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u16x8_add_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_avg_epu8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u8x16_avgr((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_avg_epu16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u16x8_avgr((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_madd_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_dot_i16x8((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_max_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_max((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_max_epu8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u8x16_max((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_min_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_min((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_min_epu8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u8x16_min((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mulhi_epi16(__m128i __a, __m128i __b)
{
  const v128_t lo = wasm_i32x4_extmul_low_i16x8((v128_t)__a, (v128_t)__b);
  const v128_t hi = wasm_i32x4_extmul_high_i16x8((v128_t)__a, (v128_t)__b);
  return (__m128i)wasm_i16x8_shuffle(lo, hi, 1, 3, 5, 7, 9, 11, 13, 15);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mulhi_epu16(__m128i __a, __m128i __b)
{
  const v128_t lo = wasm_u32x4_extmul_low_u16x8((v128_t)__a, (v128_t)__b);
  const v128_t hi = wasm_u32x4_extmul_high_u16x8((v128_t)__a, (v128_t)__b);
  return (__m128i)wasm_i16x8_shuffle(lo, hi, 1, 3, 5, 7, 9, 11, 13, 15);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mullo_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_mul((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mul_epu32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u64x2_extmul_low_u32x4(
      wasm_v32x4_shuffle((v128_t)__a, (v128_t)__a, 0, 2, 0, 2),
      wasm_v32x4_shuffle((v128_t)__b, (v128_t)__b, 0, 2, 0, 2));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sub_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_sub((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sub_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_sub((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sub_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_sub((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sub_epi64(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i64x2_sub((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_subs_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_sub_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_subs_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_sub_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_subs_epu8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u8x16_sub_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_subs_epu16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u16x8_sub_saturate((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_and_si128(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_v128_and((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_andnot_si128(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_v128_andnot((v128_t)__b, (v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_or_si128(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_v128_or((v128_t)__b, (v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_xor_si128(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_v128_xor((v128_t)__b, (v128_t)__a);
}

#define _mm_slli_si128(__a, __imm) __extension__ ({               \\
  (__m128i)wasm_i8x16_shuffle(_mm_setzero_si128(),                \\
                             (__a),                               \\
                             ((__imm)&0xF0) ? 0 : 16 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 17 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 18 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 19 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 20 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 21 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 22 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 23 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 24 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 25 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 26 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 27 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 28 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 29 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 30 - ((__imm)&0xF), \\
                             ((__imm)&0xF0) ? 0 : 31 - ((__imm)&0xF)); })
#define _mm_bslli_si128(__a, __imm) \\
  _mm_slli_si128((__a), (__imm))

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_slli_epi16(__m128i __a, int __count)
{
  return (__m128i)((__count < 16) ? wasm_i16x8_shl((v128_t)__a, __count) : wasm_i16x8_const(0,0,0,0,0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sll_epi16(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  return (__m128i)((__c < 16) ? wasm_i16x8_shl((v128_t)__a, __c) : wasm_i16x8_const(0,0,0,0,0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_slli_epi32(__m128i __a, int __count)
{
  return (__m128i)((__count < 32) ? wasm_i32x4_shl((v128_t)__a, __count) : wasm_i32x4_const(0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sll_epi32(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  return (__m128i)((__c < 32) ? wasm_i32x4_shl((v128_t)__a, __c) : wasm_i32x4_const(0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_slli_epi64(__m128i __a, int __count)
{
  return (__m128i)((__count < 64) ? wasm_i64x2_shl((v128_t)__a, __count) : wasm_i64x2_const(0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sll_epi64(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  return (__m128i)((__c < 64) ? wasm_i64x2_shl((v128_t)__a, __c) : wasm_i64x2_const(0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srai_epi16(__m128i __a, int __count)
{
  __count = __count < 15 ? __count : 15;
  return (__m128i)wasm_i16x8_shr((v128_t)__a, __count);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sra_epi16(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  __c = __c < 15 ? __c : 15;
  return (__m128i)wasm_i16x8_shr((v128_t)__a, __c);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srai_epi32(__m128i __a, int __count)
{
  __count = __count < 31 ? __count : 31;
  return (__m128i)wasm_i32x4_shr((v128_t)__a, __count);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sra_epi32(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  __c = __c < 31 ? __c : 31;
  return (__m128i)wasm_i32x4_shr((v128_t)__a, __c);
}

#define _mm_srli_si128(__a, __imm) __extension__ ({                     \\
  (__m128i)wasm_i8x16_shuffle((__a),                                    \\
                              _mm_setzero_si128(),                      \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 0,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 1,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 2,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 3,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 4,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 5,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 6,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 7,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 8,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 9,  \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 10, \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 11, \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 12, \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 13, \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 14, \\
                              ((__imm)&0xF0) ? 16 : ((__imm)&0xF) + 15); })

#define _mm_bsrli_si128(__a, __imm) \\
  _mm_srli_si128((__a), (__imm))

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srli_epi16(__m128i __a, int __count)
{
  return (__m128i)(((unsigned int)__count < 16) ? wasm_u16x8_shr((v128_t)__a, __count) : wasm_i16x8_const(0,0,0,0,0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srl_epi16(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  return (__m128i)((__c < 16) ? wasm_u16x8_shr((v128_t)__a, __c) : wasm_i16x8_const(0,0,0,0,0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srli_epi32(__m128i __a, int __count)
{
  return (__m128i)(((unsigned int)__count < 32) ? wasm_u32x4_shr((v128_t)__a, __count) : wasm_i32x4_const(0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srl_epi32(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  return (__m128i)((__c < 32) ? wasm_u32x4_shr((v128_t)__a, __c) : wasm_i32x4_const(0,0,0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srli_epi64(__m128i __a, int __count)
{
  return (__m128i)(((unsigned int)__count < 64) ? wasm_u64x2_shr((v128_t)__a, __count) : wasm_i64x2_const(0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_srl_epi64(__m128i __a, __m128i __count)
{
  unsigned long long __c = (unsigned long long)((__u64x2)__count)[0];
  return (__m128i)((__c < 64) ? wasm_u64x2_shr((v128_t)__a, __c) : wasm_i64x2_const(0,0));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_eq((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_eq((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_eq((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_gt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_gt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_gt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_lt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_lt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmplt_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_lt((v128_t)__a, (v128_t)__b);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_cvtsi64_sd(__m128d __a, long long __b)
{
  // TODO: optimize
  union {
    double x[2];
    __m128d m;
  } m;
  m.m = __a;
  m.x[0] = (double)__b;
  return m.m;
}

static __inline__ long long __attribute__((__always_inline__, __nodebug__))
_mm_cvtsd_si64(__m128d __a)
{
  // TODO: optimize
  double e = __a[0];
  if (isnan(e) || isinf(e)) return 0x8000000000000000LL;
  long long x = llrint(e);
  if (e <= LLONG_MAX && e >= LLONG_MIN && (x != 0 || fabs(e) < 2.f))
    return x;
  else
    return 0x8000000000000000LL;
}

static __inline__ long long __attribute__((__always_inline__, __nodebug__))
_mm_cvttsd_si64(__m128d __a)
{
  // TODO: optimize
  double e = __a[0];
  if (isnan(e) || isinf(e) || e > LLONG_MAX || e < LLONG_MIN) return 0x8000000000000000LL;
  long long x = llrint(e);
  if (x != 0 || fabs(e) < 2.f)
    // Use the trapping instruction here since we have explicit bounds checks
    // above
    return __builtin_wasm_trunc_s_i64_f64(e);
  else
    return 0x8000000000000000LL;
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi32_ps(__m128i __a)
{
  return (__m128)wasm_f32x4_convert_i32x4(__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtps_epi32(__m128 __a)
{
  // TODO: optimize
  union {
    int x[4];
    __m128i m;
  } u;
  for(int i = 0; i < 4; ++i)
  {
    double e = __a[i];
    int x = lrint(e);
    if (e <= INT_MAX && e >= INT_MIN && (x != 0 || fabs(e) < 2.0))
      u.x[i] = x;
    else
      u.x[i] = (int)0x80000000;
  }
  return u.m;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvttps_epi32(__m128 __a)
{
  // TODO: optimize
  union {
    int x[4];
    __m128i m;
  } u;
  for(int i = 0; i < 4; ++i)
  {
    float e = __a[i];
    if (e < 2147483648.0f && e >= -2147483648.0f && (lrint(e) != 0 || fabs(e) < 2.0))
      // Use the trapping instruction here since we have explicit bounds checks
      // above.
      u.x[i] = __builtin_wasm_trunc_s_i32_f32(e);
    else
      u.x[i] = (int)0x80000000;
  }
  return u.m;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtsi32_si128(int __a)
{
  return (__m128i)wasm_i32x4_make(__a, 0, 0, 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtsi64_si128(long long __a)
{
  return (__m128i)wasm_i64x2_make(__a, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_cvtsi128_si32(__m128i __a)
{
  return wasm_i32x4_extract_lane(__a, 0);
}

static __inline__ long long __attribute__((__always_inline__, __nodebug__))
_mm_cvtsi128_si64(__m128i __a)
{
  return wasm_i64x2_extract_lane(__a, 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_load_si128(__m128i const *__p)
{
  return *__p;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_loadu_si128(__m128i const *__p)
{
  // UB-free unaligned access copied from wasm_simd128.h
  struct __mm_loadu_si128_struct {
    __m128i __v;
  } __attribute__((__packed__, __may_alias__));
  return ((struct __mm_loadu_si128_struct*)__p)->__v;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_loadu_si16(void const *__p)
{
  return (__m128i)wasm_v128_load16_lane(__p, wasm_i64x2_const(0, 0), 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_loadu_si32(void const *__p)
{
  return (__m128i)wasm_v128_load32_zero(__p);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_loadu_si64(void const *__p)
{
  return (__m128i)wasm_v128_load64_zero(__p);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_loadl_epi64(__m128i const *__p)
{
  return _mm_loadu_si64(__p);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set_epi64(long long q1, long long q0)
{
  return (__m128i)wasm_i64x2_make(q0, q1);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set_epi32(int i3, int i2, int i1, int i0)
{
  return (__m128i)wasm_i32x4_make(i0, i1, i2, i3);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set_epi16(short w7, short w6, short w5, short w4, short w3, short w2, short w1, short w0)
{
  return (__m128i)wasm_i16x8_make(w0, w1, w2, w3, w4, w5, w6, w7);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set_epi8(char b15, char b14, char b13, char b12, char b11, char b10, char b9, char b8, char b7, char b6, char b5, char b4, char b3, char b2, char b1, char b0)
{
  return (__m128i)wasm_i8x16_make(b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set1_epi64x(long long __q)
{
  return (__m128i)wasm_i64x2_splat(__q);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set1_epi32(int __i)
{
  return (__m128i)wasm_i32x4_splat(__i);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set1_epi16(short __w)
{
  return (__m128i)wasm_i16x8_splat(__w);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_set1_epi8(char __b)
{
  return (__m128i)wasm_i8x16_splat(__b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_setr_epi32(int i0, int i1, int i2, int i3)
{
  return (__m128i)wasm_i32x4_make(i0, i1, i2, i3);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_setr_epi16(short w0, short w1, short w2, short w3, short w4, short w5, short w6, short w7)
{
  return (__m128i)wasm_i16x8_make(w0, w1, w2, w3, w4, w5, w6, w7);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_setr_epi8(char b0, char b1, char b2, char b3, char b4, char b5, char b6, char b7, char b8, char b9, char b10, char b11, char b12, char b13, char b14, char b15)
{
  return (__m128i)wasm_i8x16_make(b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_setzero_si128(void)
{
  return wasm_i64x2_const(0, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_store_si128(__m128i *__p, __m128i __b)
{
  *__p = __b;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeu_si16(void *__p, __m128i __a)
{
  wasm_v128_store16_lane(__p, (v128_t)__a, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeu_si32(void *__p, __m128i __a)
{
  wasm_v128_store32_lane(__p, (v128_t)__a, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeu_si64(void *__p, __m128i __a)
{
  wasm_v128_store64_lane(__p, (v128_t)__a, 0);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storeu_si128(__m128i *__p, __m128i __a)
{
  // UB-free unaligned access copied from wasm_simd128.h
  struct __mm_storeu_si128_struct {
    __m128i __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __mm_storeu_si128_struct *)__p)->__v = __a;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_maskmoveu_si128(__m128i __d, __m128i __n, char *__p)
{
  // TODO: optimize
  union {
    unsigned char x[16];
    __m128i m;
  } mask, data;
  mask.m = __n;
  data.m = __d;
  for(int i = 0; i < 16; ++i)
    if (mask.x[i] & 0x80)
      __p[i] = data.x[i];
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_storel_epi64(__m128i *__p, __m128i __a)
{
  _mm_storeu_si64(__p, __a);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_stream_pd(double *__p, __m128d __a)
{
  // Emscripten/SIMD.js does not have cache hinting.
  _mm_store_pd(__p, __a);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_stream_si128(__m128i *__p, __m128i __a)
{
  // Emscripten/SIMD.js does not have cache hinting.
  _mm_store_si128(__p, __a);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_stream_si32(int *__p, int __a)
{
  // No cache hinting available.
  *__p = __a;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_stream_si64(long long *__p, long long __a)
{
  // No cache hinting available.
  *__p = __a;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_clflush(void const *__p)
{
  // Wasm SIMD does not have cache hinting
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_lfence(void)
{
  __sync_synchronize(); // Wasm/SharedArrayBuffer has only a full barrier instruction, which gives a stronger guarantee.
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_mfence(void)
{
  __sync_synchronize(); // Wasm/SharedArrayBuffer has only a full barrier instruction, which gives a stronger guarantee.
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_packs_epi16(__m128i __a, __m128i __b)
{
  return wasm_i8x16_narrow_i16x8(__a, __b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_packs_epi32(__m128i __a, __m128i __b)
{
  return wasm_i16x8_narrow_i32x4(__a, __b);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_packus_epi16(__m128i __a, __m128i __b)
{
  return wasm_u8x16_narrow_i16x8(__a, __b);
}

#define _mm_extract_epi16(__a, __imm) wasm_u16x8_extract_lane((v128_t)(__a), (__imm) & 7)
#define _mm_insert_epi16(__a, __b, __imm) wasm_i16x8_replace_lane((__a), (__imm) & 7, (__b))

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_movemask_epi8(__m128i __a)
{
  return (int)wasm_i8x16_bitmask((v128_t)__a);
}

#define _mm_shuffle_epi32(__a, __imm) __extension__ ({ \\
  (__m128i)wasm_i32x4_shuffle((__a), \\
                              _mm_set1_epi32(0), \\
                              ((__imm) & 0x3), (((__imm) & 0xc) >> 2), \\
                              (((__imm) & 0x30) >> 4), (((__imm) & 0xc0) >> 6)); })

#define _mm_shufflelo_epi16(__a, __imm) __extension__ ({ \\
  (__m128i)wasm_i16x8_shuffle((__a), \\
                              _mm_set1_epi16(0), \\
                              ((__imm) & 0x3), (((__imm) & 0xc) >> 2), \\
                              (((__imm) & 0x30) >> 4), (((__imm) & 0xc0) >> 6), \\
                              4, 5, 6, 7); })

#define _mm_shufflehi_epi16(__a, __imm) __extension__ ({ \\
  (__m128i)wasm_i16x8_shuffle((__a), \\
                              _mm_set1_epi16(0), \\
                              0, 1, 2, 3, \\
                              (4 + (((__imm) & 0x03) >> 0)), \\
                              (4 + (((__imm) & 0x0c) >> 2)), \\
                              (4 + (((__imm) & 0x30) >> 4)), \\
                              (4 + (((__imm) & 0xc0) >> 6))); })

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpackhi_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_shuffle(__a, __b, 8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29, 14, 30, 15, 31);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpackhi_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_shuffle(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpackhi_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_shuffle(__a, __b, 2, 6, 3, 7);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpackhi_epi64(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i64x2_shuffle(__a, __b, 1, 3);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpacklo_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_shuffle(__a, __b, 0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpacklo_epi16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i16x8_shuffle(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpacklo_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_shuffle(__a, __b, 0, 4, 1, 5);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_unpacklo_epi64(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i64x2_shuffle(__a, __b, 0, 2);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_move_epi64(__m128i __a)
{
  return wasm_i64x2_shuffle(__a, wasm_i64x2_const(0, 0), 0, 2);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_unpackhi_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_i64x2_shuffle((v128_t)__a, (v128_t)__b, 1, 3);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_unpacklo_pd(__m128d __a, __m128d __b)
{
  return (__m128d)wasm_i64x2_shuffle((v128_t)__a, (v128_t)__b, 0, 2);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_movemask_pd(__m128d __a)
{
  return (int)wasm_i64x2_bitmask((v128_t)__a);
}

#define _mm_shuffle_pd(__a, __b, __i) __extension__ ({ \\
  (__m128d) __builtin_shufflevector((__u64x2)(__a), (__u64x2)(__b), \\
                                    (__i) & 1, \\
                                    (((__i) & 2) >> 1) + 2); })

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_castpd_ps(__m128d __a)
{
  return (__m128)__a;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_castpd_si128(__m128d __a)
{
  return (__m128i)__a;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_castps_pd(__m128 __a)
{
  return (__m128d)__a;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_castps_si128(__m128 __a)
{
  return (__m128i)__a;
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_castsi128_ps(__m128i __a)
{
  return (__m128)__a;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_castsi128_pd(__m128i __a)
{
  return (__m128d)__a;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_pause(void)
{
  // No pause/wait instruction in Wasm/SIMD.
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_undefined_pd()
{
  __m128d val;
  return val;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_undefined_si128()
{
  __m128i val;
  return val;
}

// Must be in the very end as it uses other SSE2 intrinsics
static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sad_epu8(__m128i __a, __m128i __b)
{
  __m128i __diff = _mm_or_si128(_mm_subs_epu8(__a, __b),
                                _mm_subs_epu8(__b, __a));
  __diff = _mm_add_epi16(_mm_srli_epi16(__diff, 8),
                         _mm_and_si128(__diff, _mm_set1_epi16(0x00FF)));
  __diff = _mm_add_epi16(__diff, _mm_slli_epi32(__diff, 16));
  __diff = _mm_add_epi16(__diff, _mm_slli_epi64(__diff, 32));
  return _mm_srli_epi64(__diff, 48);
}

#define _MM_SHUFFLE2(x, y) (((x) << 1) | (y))

#endif /* __emscripten_emmintrin_h__ */
`,"pmmintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_pmmintrin_h__
#define __emscripten_pmmintrin_h__

#ifndef __SSE3__
#error "SSE3 instruction set not enabled"
#endif

#include <emmintrin.h>

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_lddqu_si128(__m128i const *__p)
{
  return _mm_loadu_si128(__p);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_addsub_ps(__m128 __a, __m128 __b)
{
  return _mm_add_ps(__a, _mm_mul_ps(__b, _mm_set_ps(1.f, -1.f, 1.f, -1.f)));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_hadd_ps(__m128 __a, __m128 __b)
{
  return _mm_add_ps(_mm_shuffle_ps(__a, __b, _MM_SHUFFLE(2, 0, 2, 0)), _mm_shuffle_ps(__a, __b, _MM_SHUFFLE(3, 1, 3, 1)));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_hsub_ps(__m128 __a, __m128 __b)
{
  return _mm_sub_ps(_mm_shuffle_ps(__a, __b, _MM_SHUFFLE(2, 0, 2, 0)), _mm_shuffle_ps(__a, __b, _MM_SHUFFLE(3, 1, 3, 1)));
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_movehdup_ps(__m128 __a)
{
  return (__m128)wasm_i32x4_shuffle(__a, __a, 1, 1, 3, 3);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_moveldup_ps(__m128 __a)
{
  return (__m128)wasm_i32x4_shuffle(__a, __a, 0, 0, 2, 2);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_addsub_pd(__m128d __a, __m128d __b)
{
  return _mm_add_pd(__a, _mm_mul_pd(__b, _mm_set_pd(1.0, -1.0)));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_hadd_pd(__m128d __a, __m128d __b)
{
  return _mm_add_pd(_mm_shuffle_pd(__a, __b, _MM_SHUFFLE2(0, 0)), _mm_shuffle_pd(__a, __b, _MM_SHUFFLE2(1, 1)));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_hsub_pd(__m128d __a, __m128d __b)
{
  return _mm_sub_pd(_mm_shuffle_pd(__a, __b, _MM_SHUFFLE2(0, 0)), _mm_shuffle_pd(__a, __b, _MM_SHUFFLE2(1, 1)));
}

#define        _mm_loaddup_pd(dp)        _mm_load1_pd(dp)

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_movedup_pd(__m128d __a)
{
  return (__m128d)wasm_i64x2_shuffle(__a, __a, 0, 0);
}

#define _MM_DENORMALS_ZERO_ON   (0x0040)
#define _MM_DENORMALS_ZERO_OFF  (0x0000)
#define _MM_DENORMALS_ZERO_MASK (0x0040)
#define _MM_GET_DENORMALS_ZERO_MODE() (_mm_getcsr() & _MM_DENORMALS_ZERO_MASK)

// Unavailable functions:
// #define _MM_SET_DENORMALS_ZERO_MODE(x) (_mm_setcsr((_mm_getcsr() & ~_MM_DENORMALS_ZERO_MASK) | (x)))
// void _mm_monitor(void const *__p, unsigned __extensions, unsigned __hints);
// void _mm_mwait(unsigned __extensions, unsigned __hints);

#endif /* __emscripten_pmmintrin_h__ */
`,"tmmintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_tmmintrin_h__
#define __emscripten_tmmintrin_h__

#ifndef __SSSE3__
#error "SSSE3 instruction set not enabled"
#endif

#include <pmmintrin.h>

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_abs_epi8(__m128i __a)
{
  return (__m128i)wasm_i8x16_abs((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_abs_epi16(__m128i __a)
{
  return (__m128i)wasm_i16x8_abs((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_abs_epi32(__m128i __a)
{
  return (__m128i)wasm_i32x4_abs((v128_t)__a);
}

#define _mm_alignr_epi8(__a, __b, __count) \\
    ((__count <= 16) \\
    ? (_mm_or_si128(_mm_bslli_si128((__a), 16 - (((unsigned int)(__count)) & 0xFF)), _mm_bsrli_si128((__b), (((unsigned int)(__count)) & 0xFF)))) \\
    : (_mm_bsrli_si128((__a), (((unsigned int)(__count)) & 0xFF) - 16)))

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_hadd_epi16(__m128i __a, __m128i __b)
{
  return _mm_add_epi16((__m128i)wasm_i16x8_shuffle(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14),
                       (__m128i)wasm_i16x8_shuffle(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_hadd_epi32(__m128i __a, __m128i __b)
{
  return _mm_add_epi32((__m128i)_mm_shuffle_ps((__m128)__a, (__m128)__b, _MM_SHUFFLE(2, 0, 2, 0)),
                       (__m128i)_mm_shuffle_ps((__m128)__a, (__m128)__b, _MM_SHUFFLE(3, 1, 3, 1)));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_hadds_epi16(__m128i __a, __m128i __b)
{
  return _mm_adds_epi16((__m128i)wasm_i16x8_shuffle(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14),
                        (__m128i)wasm_i16x8_shuffle(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_hsub_epi16(__m128i __a, __m128i __b)
{
  return _mm_sub_epi16((__m128i)wasm_i16x8_shuffle(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14),
                       (__m128i)wasm_i16x8_shuffle(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_hsub_epi32(__m128i __a, __m128i __b)
{
  return _mm_sub_epi32((__m128i)_mm_shuffle_ps((__m128)__a, (__m128)__b, _MM_SHUFFLE(2, 0, 2, 0)),
                       (__m128i)_mm_shuffle_ps((__m128)__a, (__m128)__b, _MM_SHUFFLE(3, 1, 3, 1)));
}


static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_hsubs_epi16(__m128i __a, __m128i __b)
{
  return _mm_subs_epi16((__m128i)wasm_i16x8_shuffle(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14),
                        (__m128i)wasm_i16x8_shuffle(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_maddubs_epi16(__m128i __a, __m128i __b)
{
  return _mm_adds_epi16(
    _mm_mullo_epi16(
      _mm_and_si128(__a, _mm_set1_epi16(0x00FF)),
      _mm_srai_epi16(_mm_slli_epi16(__b, 8), 8)),
    _mm_mullo_epi16(_mm_srli_epi16(__a, 8), _mm_srai_epi16(__b, 8)));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mulhrs_epi16(__m128i __a, __m128i __b)
{
  v128_t __lo = wasm_i32x4_mul(wasm_i32x4_widen_low_i16x8((v128_t)__a), wasm_i32x4_widen_low_i16x8((v128_t)__b));
  v128_t __hi = wasm_i32x4_mul(wasm_i32x4_widen_high_i16x8((v128_t)__a), wasm_i32x4_widen_high_i16x8((v128_t)__b));
  const v128_t __inc = wasm_i32x4_splat(0x4000);
  __lo = wasm_i32x4_add(__lo, __inc);
  __hi = wasm_i32x4_add(__hi, __inc);
  __lo = wasm_i32x4_add(__lo, __lo);
  __hi = wasm_i32x4_add(__hi, __hi);
  return (__m128i)wasm_i16x8_shuffle(__lo, __hi, 1, 3, 5, 7, 9, 11, 13, 15);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_shuffle_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_v8x16_swizzle((v128_t)__a, (v128_t)_mm_and_si128(__b, _mm_set1_epi8(0x8F)));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sign_epi8(__m128i __a, __m128i __b)
{
  const __m128i __zero = _mm_setzero_si128();
  __a = _mm_andnot_si128(_mm_cmpeq_epi8(__b, __zero), __a);
  const __m128i __mask = _mm_cmpgt_epi8(__zero, __b);
  return _mm_xor_si128(_mm_add_epi8(__a, __mask), __mask);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sign_epi16(__m128i __a, __m128i __b)
{
  const __m128i __zero = _mm_setzero_si128();
  __a = _mm_andnot_si128(_mm_cmpeq_epi16(__b, __zero), __a);
  const __m128i __mask = _mm_cmpgt_epi16(__zero, __b);
  return _mm_xor_si128(_mm_add_epi16(__a, __mask), __mask);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_sign_epi32(__m128i __a, __m128i __b)
{
  const __m128i __zero = _mm_setzero_si128();
  __a = _mm_andnot_si128(_mm_cmpeq_epi32(__b, __zero), __a);
  const __m128i __mask = _mm_cmpgt_epi32(__zero, __b);
  return _mm_xor_si128(_mm_add_epi32(__a, __mask), __mask);
}

// Unavailable functions:
// _mm_abs_pi8
// _mm_abs_pi16
// _mm_abs_pi32
// _mm_alignr_pi8
// _mm_hadd_pi16
// _mm_hadd_pi32
// _mm_hadds_pi16
// _mm_hsub_pi16
// _mm_hsub_pi32
// _mm_hsubs_pi16
// _mm_maddubs_pi16
// _mm_mulhrs_pi16
// _mm_shuffle_pi8
// _mm_sign_pi8
// _mm_sign_pi16
// _mm_sign_pi32

#endif /* __emscripten_tmmintrin_h__ */
`,"smmintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_smmintrin_h__
#define __emscripten_smmintrin_h__

#ifndef __SSE4_1__
#error "SSE4.1 instruction set not enabled"
#endif

#include <tmmintrin.h>
#include <math.h> // For rint and rintf

#define _mm_blend_epi16(__a, __b, __imm8) __extension__ ({     \\
  (__m128i)__builtin_shufflevector((__i16x8)(__m128i)(__a),    \\
                                   (__i16x8)(__m128i)(__b),    \\
                                   (((__imm8) & 1) ?  8 : 0),  \\
                                   (((__imm8) & 2) ?  9 : 1),  \\
                                   (((__imm8) & 4) ? 10 : 2),  \\
                                   (((__imm8) & 8) ? 11 : 3),  \\
                                   (((__imm8) & 16) ? 12 : 4), \\
                                   (((__imm8) & 32) ? 13 : 5), \\
                                   (((__imm8) & 64) ? 14 : 6), \\
                                   (((__imm8) & 128) ? 15 : 7)); })

#define _mm_blend_pd(__a, __b, __imm8) __extension__ ({         \\
  (__m128d)__builtin_shufflevector((__f64x2)(__m128d)(__a),     \\
                                   (__f64x2)(__m128d)(__b),     \\
                                   (((__imm8) & 0x01) ? 2 : 0), \\
                                   (((__imm8) & 0x02) ? 3 : 1)); })

#define _mm_blend_ps(__a, __b, __imm8) __extension__ ({ \\
  (__m128)__builtin_shufflevector((__f32x4)(__m128)(__a), (__f32x4)(__m128)(__b), \\
                                  (((__imm8) & 0x01) ? 4 : 0), \\
                                  (((__imm8) & 0x02) ? 5 : 1), \\
                                  (((__imm8) & 0x04) ? 6 : 2), \\
                                  (((__imm8) & 0x08) ? 7 : 3)); })

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_blendv_epi8(__m128i __a, __m128i __b, __m128i __mask)
{
  v128_t __M = wasm_i8x16_shr((v128_t)__mask, 7);
  return (__m128i)wasm_v128_bitselect((v128_t)__b, (v128_t)__a, __M);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_blendv_pd(__m128d __a, __m128d __b, __m128d __mask)
{
  v128_t __M = wasm_i64x2_shr((v128_t)__mask, 63);
  return (__m128d)wasm_v128_bitselect((v128_t)__b, (v128_t)__a, __M);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_blendv_ps(__m128 __a, __m128 __b, __m128 __mask)
{
  v128_t __M = wasm_i32x4_shr((v128_t)__mask, 31);
  return (__m128)wasm_v128_bitselect((v128_t)__b, (v128_t)__a, __M);
}

#define _MM_FROUND_TO_NEAREST_INT    0x00
#define _MM_FROUND_TO_NEG_INF        0x01
#define _MM_FROUND_TO_POS_INF        0x02
#define _MM_FROUND_TO_ZERO           0x03
#define _MM_FROUND_CUR_DIRECTION     0x04

#define _MM_FROUND_RAISE_EXC         0x00
#define _MM_FROUND_NO_EXC            0x08

#define _MM_FROUND_NINT      (_MM_FROUND_RAISE_EXC | _MM_FROUND_TO_NEAREST_INT)
#define _MM_FROUND_FLOOR     (_MM_FROUND_RAISE_EXC | _MM_FROUND_TO_NEG_INF)
#define _MM_FROUND_CEIL      (_MM_FROUND_RAISE_EXC | _MM_FROUND_TO_POS_INF)
#define _MM_FROUND_TRUNC     (_MM_FROUND_RAISE_EXC | _MM_FROUND_TO_ZERO)
#define _MM_FROUND_RINT      (_MM_FROUND_RAISE_EXC | _MM_FROUND_CUR_DIRECTION)
#define _MM_FROUND_NEARBYINT (_MM_FROUND_NO_EXC | _MM_FROUND_CUR_DIRECTION)

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_ceil_pd(__m128d __a)
{
  return (__m128d)wasm_f64x2_ceil((v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_ceil_ps(__m128 __a)
{
  return (__m128)wasm_f32x4_ceil((v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_ceil_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_ceil_ps(__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_ceil_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_ceil_pd(__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_floor_pd(__m128d __a)
{
  return (__m128d)wasm_f64x2_floor((v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_floor_ps(__m128 __a)
{
  return (__m128)wasm_f32x4_floor((v128_t)__a);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_floor_ss(__m128 __a, __m128 __b)
{
  return _mm_move_ss(__a, _mm_floor_ps(__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_floor_sd(__m128d __a, __m128d __b)
{
  return _mm_move_sd(__a, _mm_floor_pd(__b));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_round_pd(__m128d __a, int __rounding)
{
  switch(__rounding & 7)
  {
    case _MM_FROUND_TO_NEG_INF: return _mm_floor_pd(__a);
    case _MM_FROUND_TO_POS_INF: return _mm_ceil_pd(__a);
    case _MM_FROUND_TO_ZERO:
      return (__m128d)wasm_f64x2_trunc((v128_t)__a);
    default:
      // _MM_FROUND_TO_NEAREST_INT and _MM_FROUND_CUR_DIRECTION (which is always nearest in Wasm SIMD)
      // SSE implements "Banker's rounding", where even half-ways, e.g. 2.5 are rounded down,
      // and odd numbers e.g. 3.5 are rounded up.
      return (__m128d)wasm_f64x2_nearest((v128_t)__a);
  }
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_round_ps(__m128 __a, int __rounding)
{
  switch(__rounding & 7)
  {
    case _MM_FROUND_TO_NEG_INF: return _mm_floor_ps(__a);
    case _MM_FROUND_TO_POS_INF: return _mm_ceil_ps(__a);
    case _MM_FROUND_TO_ZERO:
      return (__m128)wasm_f32x4_trunc((v128_t)__a);
    default:
      // _MM_FROUND_TO_NEAREST_INT and _MM_FROUND_CUR_DIRECTION (which is always nearest in Wasm SIMD)
      // SSE implements "Banker's rounding", where even half-ways, e.g. 2.5 are rounded down,
      // and odd numbers e.g. 3.5 are rounded up.
      return (__m128)wasm_f32x4_nearest((v128_t)__a);
  }
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_round_ss(__m128 __a, __m128 __b, int __rounding)
{
  return _mm_move_ss(__a, _mm_round_ps(__b, __rounding));
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_round_sd(__m128d __a, __m128d __b, int __rounding)
{
  return _mm_move_sd(__a, _mm_round_pd(__b, __rounding));
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mullo_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_mul(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mul_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i64x2_extmul_low_i32x4(
      (v128_t)_mm_shuffle_epi32(__a, _MM_SHUFFLE(2, 0, 2, 0)),
      (v128_t)_mm_shuffle_epi32(__b, _MM_SHUFFLE(2, 0, 2, 0)));
}

#define _mm_dp_ps(__a, __b, __imm8) __extension__ ({ \\
        __m128 __tmp = _mm_mul_ps(__a, __b); \\
        __m128 __zero = _mm_setzero_ps(); \\
        __tmp = _mm_blend_ps(__zero, __tmp, __imm8 >> 4); \\
        __m128 __sum = _mm_add_ps(__tmp, _mm_shuffle_ps(__tmp, __tmp, _MM_SHUFFLE(2, 3, 0, 1))); \\
        __sum = _mm_add_ps(__sum, _mm_shuffle_ps(__sum, __sum, _MM_SHUFFLE(1, 0, 3, 2))); \\
        _mm_blend_ps(__zero, __sum, __imm8); })

#define _mm_dp_pd(__a, __b, __imm8) __extension__ ({ \\
        __m128d __tmp = _mm_mul_pd(__a, __b); \\
        __m128d __zero = _mm_setzero_pd(); \\
        __tmp = _mm_blend_pd(__zero, __tmp, __imm8 >> 4); \\
        __m128d __sum = _mm_add_pd(__tmp, _mm_shuffle_pd(__tmp, __tmp, _MM_SHUFFLE2(0, 1))); \\
        _mm_blend_pd(__zero, __sum, __imm8); })

#define _mm_stream_load_si128 _mm_load_si128

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_min_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_min(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_max_epi8(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i8x16_max(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_min_epu16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u16x8_min(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_max_epu16(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u16x8_max(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_min_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_min(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_max_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_i32x4_max(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_min_epu32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u32x4_min(__a, __b);
}

static __inline__  __m128i __attribute__((__always_inline__, __nodebug__))
_mm_max_epu32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u32x4_max(__a, __b);
}

#define _mm_insert_ps(__a, __b, __imm8) __extension__ ({       \\
        _Static_assert(__builtin_constant_p(__imm8), "Expected constant"); \\
        __m128 __tmp = __builtin_shufflevector((__f32x4)__a, (__f32x4)__b, \\
                            ((((__imm8) >> 4) & 3) == 0) ? ((((__imm8) >> 6) & 3) + 4) : 0, \\
                            ((((__imm8) >> 4) & 3) == 1) ? ((((__imm8) >> 6) & 3) + 4) : 1, \\
                            ((((__imm8) >> 4) & 3) == 2) ? ((((__imm8) >> 6) & 3) + 4) : 2, \\
                            ((((__imm8) >> 4) & 3) == 3) ? ((((__imm8) >> 6) & 3) + 4) : 3); \\
        (__m128)__builtin_shufflevector(__tmp, _mm_setzero_ps(), \\
                                        (((__imm8) & 1) ? 4 : 0), \\
                                        (((__imm8) & 2) ? 5 : 1), \\
                                        (((__imm8) & 4) ? 6 : 2), \\
                                        (((__imm8) & 8) ? 7 : 3)); })

#define _mm_extract_ps(__a, __imm8)                                                                \\
  __extension__({ wasm_i32x4_extract_lane((v128_t)(__a), (__imm8)&3); })

#define _MM_EXTRACT_FLOAT(D, X, N) (__extension__ ({ __f32x4 __a = (__f32x4)(X); \\
                                                    (D) = __a[N]; }))

#define _MM_MK_INSERTPS_NDX(X, Y, Z) (((X) << 6) | ((Y) << 4) | (Z))

#define _MM_PICK_OUT_PS(X, N) _mm_insert_ps(_mm_setzero_ps(), (X),   \\
                                             _MM_MK_INSERTPS_NDX((N), 0, 0x0e))

#define _mm_insert_epi8(__a, __i, __imm8) __extension__ ({    \\
                                     (__m128i)wasm_i8x16_replace_lane((__a), (__imm8) & 15, (__i)); })

#define _mm_insert_epi32(__a, __i, __imm8) __extension__ ({    \\
                                     (__m128i)wasm_i32x4_replace_lane((__a), (__imm8) & 3, (__i)); })

#define _mm_insert_epi64(__a, __i, __imm8) __extension__ ({    \\
                                     (__m128i)wasm_i64x2_replace_lane((__a), (__imm8) & 1, (__i)); })

#define _mm_extract_epi8(__a, __imm8) __extension__ ({       \\
                                       wasm_u8x16_extract_lane((__a), (__imm8) & 15); })

#define _mm_extract_epi32(__a, __imm8) __extension__ ({       \\
                                       wasm_i32x4_extract_lane((__a), (__imm8) & 3); })

#define _mm_extract_epi64(__a, __imm8) __extension__ ({       \\
                                       wasm_i64x2_extract_lane((__a), (__imm8) & 1); })

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_testz_si128(__m128i __a, __m128i __b)
{
  v128_t __m = wasm_v128_and(__a, __b);
  return (wasm_i64x2_extract_lane(__m, 0) | wasm_i64x2_extract_lane(__m, 1)) == 0;
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_testc_si128(__m128i __a, __m128i __b)
{
  v128_t __m = wasm_v128_andnot(__b, __a);
  return (wasm_i64x2_extract_lane(__m, 0) | wasm_i64x2_extract_lane(__m, 1)) == 0;
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testnzc_si128(__m128i __a, __m128i __b)
{
  v128_t __m1 = wasm_v128_and(__a, __b);
  v128_t __m2 = wasm_v128_andnot(__b, __a);
  return (wasm_i64x2_extract_lane(__m1, 0) | wasm_i64x2_extract_lane(__m1, 1))
      && (wasm_i64x2_extract_lane(__m2, 0) | wasm_i64x2_extract_lane(__m2, 1));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_test_all_ones(__m128i __a)
{
  return (wasm_i64x2_extract_lane(__a, 0) & wasm_i64x2_extract_lane(__a, 1)) == 0xFFFFFFFFFFFFFFFFull;
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_test_all_zeros(__m128i __a, __m128i __mask)
{
  v128_t __m = wasm_v128_and(__a, __mask);
  return (wasm_i64x2_extract_lane(__m, 0) | wasm_i64x2_extract_lane(__m, 1)) == 0;
}

static __inline__ int __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
_mm_test_mix_ones_zeros(__m128i __a, __m128i __mask)
{
  v128_t __m = wasm_v128_and(__a, __mask);
  long long __c0 = wasm_i64x2_extract_lane(__m, 0);
  long long __c1 = wasm_i64x2_extract_lane(__m, 1);
  long long __ones = __c0 | __c1;
  long long __zeros = ~(__c0 & __c1);
  return __ones && __zeros;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpeq_epi64(__m128i __a, __m128i __b)
{
  const __m128i __mask = _mm_cmpeq_epi32(__a, __b);
  return _mm_and_si128(__mask, _mm_shuffle_epi32(__mask, _MM_SHUFFLE(2, 3, 0, 1)));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi8_epi16(__m128i __a)
{
  return (__m128i)wasm_i16x8_widen_low_i8x16((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi8_epi32(__m128i __a)
{
  return (__m128i)wasm_i32x4_widen_low_i16x8(wasm_i16x8_widen_low_i8x16((v128_t)__a));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi8_epi64(__m128i __a)
{
  const __m128i __exta = _mm_cvtepi8_epi32(__a);
  const __m128i __sign = _mm_cmpgt_epi32(_mm_setzero_si128(), __exta);
  return _mm_unpacklo_epi32(__exta, __sign);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi16_epi32(__m128i __a)
{
  return (__m128i)wasm_i32x4_widen_low_i16x8((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi16_epi64(__m128i __a)
{
  const __m128i __exta = _mm_cvtepi16_epi32(__a);
  const __m128i __sign = _mm_cmpgt_epi32(_mm_setzero_si128(), __exta);
  return _mm_unpacklo_epi32(__exta, __sign);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepi32_epi64(__m128i __a)
{
  const __m128i __sign = _mm_cmpgt_epi32(_mm_setzero_si128(), __a);
  return _mm_unpacklo_epi32(__a, __sign);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepu8_epi16(__m128i __a)
{
  return (__m128i)wasm_u16x8_extend_low_u8x16((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepu8_epi32(__m128i __a)
{
  return (__m128i)wasm_u32x4_extend_low_u16x8(wasm_i16x8_widen_low_u8x16((v128_t)__a));
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepu8_epi64(__m128i __a)
{
  const __m128i __zero = _mm_setzero_si128();
  return _mm_unpacklo_epi32(_mm_unpacklo_epi16(_mm_unpacklo_epi8(__a, __zero), __zero), __zero);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepu16_epi32(__m128i __a)
{
  return (__m128i)wasm_u32x4_extend_low_u16x8((v128_t)__a);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepu16_epi64(__m128i __a)
{
  const __m128i __zero = _mm_setzero_si128();
  return _mm_unpacklo_epi32(_mm_unpacklo_epi16(__a, __zero), __zero);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cvtepu32_epi64(__m128i __a)
{
  const __m128i __zero = _mm_setzero_si128();
  return _mm_unpacklo_epi32(__a, __zero);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_packus_epi32(__m128i __a, __m128i __b)
{
  return (__m128i)wasm_u16x8_narrow_i32x4(__a, __b);
}

static __inline__ unsigned short __attribute__((__always_inline__, __nodebug__))
__uabs(int __i)
{
  return (unsigned short)((__i >= 0) ? __i : -__i);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_mpsadbw_epu8(__m128i __a, __m128i __b, int __imm8)
{
  int __aOffset = __imm8 & 4;
  int __bOffset = (__imm8 & 3) << 2;
  unsigned short __ret[8];
  for(int __i = 0; __i < 8; ++__i)
  {
    __ret[__i] = __uabs(((__u8x16)__a)[__i + __aOffset    ] - ((__u8x16)__b)[__bOffset    ])
               + __uabs(((__u8x16)__a)[__i + __aOffset + 1] - ((__u8x16)__b)[__bOffset + 1])
               + __uabs(((__u8x16)__a)[__i + __aOffset + 2] - ((__u8x16)__b)[__bOffset + 2])
               + __uabs(((__u8x16)__a)[__i + __aOffset + 3] - ((__u8x16)__b)[__bOffset + 3]);
  }
  return (__m128i)wasm_v128_load(__ret);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_minpos_epu16(__m128i __a)
{
  unsigned short __min[2] = { 0xFFFF, 0 };
  for(int __i = 0; __i < 8; ++__i)
  {
    unsigned short __v = ((__u16x8)__a)[__i];
    if (__v < __min[0])
    {
      __min[0] = __v;
      __min[1] = __i;
    }
  }
  return (__m128i)wasm_i32x4_make(*(int*)__min, 0, 0, 0);
}

// Clang and GCC compatibility: Both Clang and GCC include SSE4.2 headers from SSE4.1 headers
#ifdef __SSE4_2__
#include <nmmintrin.h>
#endif

#endif /* __emscripten_smmintrin_h__ */
`,"nmmintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */
#ifndef __emscripten_nmmintrin_h__
#define __emscripten_nmmintrin_h__

#ifndef __SSE4_2__
#error "SSE4.2 instruction set not enabled"
#endif

#include <smmintrin.h>

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_cmpgt_epi64(__m128i __a, __m128i __b)
{
  return wasm_i64x2_gt(__a, __b);
}

// Unsupported functions:
// _mm_cmpestra
// _mm_cmpestrc
// _mm_cmpestri
// _mm_cmpestrm
// _mm_cmpestro
// _mm_cmpestrs
// _mm_cmpestrz
// _mm_cmpistra
// _mm_cmpistrc
// _mm_cmpistri
// _mm_cmpistrm
// _mm_cmpistro
// _mm_cmpistrs
// _mm_cmpistrz
// _mm_crc32_u16
// _mm_crc32_u32
// _mm_crc32_u64
// _mm_crc32_u8

#endif /* __emscripten_nmmintrin_h__ */
`,"avxintrin.h":`/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

#ifndef __emscripten_immintrin_h__
#error "Never use <avxintrin.h> directly; include <immintrin.h> instead."
#endif

#ifndef __emscripten_avxintrin_h__
#define __emscripten_avxintrin_h__

#ifndef __AVX__
#error "AVX instruction set not enabled"
#endif

typedef float __m256 __attribute__((__vector_size__(32), __aligned__(32)));
typedef double __m256d __attribute__((__vector_size__(32), __aligned__(32)));
typedef int32_t __m256i __attribute__((__vector_size__(32), __aligned__(32)));

typedef int32_t __m128i_u __attribute__((__vector_size__(16), __aligned__(1)));
typedef int32_t __m256i_u __attribute__((__vector_size__(32), __aligned__(1)));

typedef struct {
  __m128d v0;
  __m128d v1;
} __m256d_internal;

typedef struct {
  __m128 v0;
  __m128 v1;
} __m256_internal;

typedef struct {
    __m128i v0;
    __m128i v1;
} __m256i_internal;

static __inline__ __m256_internal __m256_to_internal(__m256 a) {
  union {
    __m256 in;
    __m256_internal out;
  } ret;
  ret.in = a;
  return ret.out;
}

static __inline__ __m256 __m256_from_internal(__m256_internal a) {
  union {
    __m256_internal in;
    __m256 out;
  } ret;
  ret.in = a;
  return ret.out;
}

static __inline__ __m256d_internal __m256d_to_internal(__m256d a) {
  union {
    __m256d in;
    __m256d_internal out;
  } ret;
  ret.in = a;
  return ret.out;
}

static __inline__ __m256d __m256d_from_internal(__m256d_internal a) {
  union {
    __m256d_internal in;
    __m256d out;
  } ret;
  ret.in = a;
  return ret.out;
}

static __inline__ __m256i_internal __m256i_to_internal(__m256i a) {
  union {
    __m256i in;
    __m256i_internal out;
  } ret;
  ret.in = a;
  return ret.out;
}

static __inline__ __m256i __m256i_from_internal(__m256i_internal a) {
  union {
    __m256i_internal in;
    __m256i out;
  } ret;
  ret.in = a;
  return ret.out;
}

union __m256_data {
  __m256i int_view;
  __m256d double_view;
  __m256 float_view;
  __m128i_u int_u_view;
};

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_add_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_add_pd(a.v0, b.v0);
  ret.v1 = _mm_add_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_add_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_add_ps(a.v0, b.v0);
  ret.v1 = _mm_add_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_sub_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_sub_pd(a.v0, b.v0);
  ret.v1 = _mm_sub_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_sub_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_sub_ps(a.v0, b.v0);
  ret.v1 = _mm_sub_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_addsub_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_addsub_pd(a.v0, b.v0);
  ret.v1 = _mm_addsub_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_addsub_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_addsub_ps(a.v0, b.v0);
  ret.v1 = _mm_addsub_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_div_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_div_pd(a.v0, b.v0);
  ret.v1 = _mm_div_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_div_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_div_ps(a.v0, b.v0);
  ret.v1 = _mm_div_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_max_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_max_pd(a.v0, b.v0);
  ret.v1 = _mm_max_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_max_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_max_ps(a.v0, b.v0);
  ret.v1 = _mm_max_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_min_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_min_pd(a.v0, b.v0);
  ret.v1 = _mm_min_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_min_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_min_ps(a.v0, b.v0);
  ret.v1 = _mm_min_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_mul_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_mul_pd(a.v0, b.v0);
  ret.v1 = _mm_mul_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_mul_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_mul_ps(a.v0, b.v0);
  ret.v1 = _mm_mul_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_sqrt_pd(__m256d __a) {
  __m256d_internal ret, a;
  a = __m256d_to_internal(__a);
  ret.v0 = _mm_sqrt_pd(a.v0);
  ret.v1 = _mm_sqrt_pd(a.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_sqrt_ps(__m256 __a) {
  __m256_internal ret, a;
  a = __m256_to_internal(__a);
  ret.v0 = _mm_sqrt_ps(a.v0);
  ret.v1 = _mm_sqrt_ps(a.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_rsqrt_ps(__m256 __a) {
  __m256_internal ret, a;
  a = __m256_to_internal(__a);
  ret.v0 = _mm_rsqrt_ps(a.v0);
  ret.v1 = _mm_rsqrt_ps(a.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_rcp_ps(__m256 __a) {
  __m256_internal ret, a;
  a = __m256_to_internal(__a);
  ret.v0 = _mm_rcp_ps(a.v0);
  ret.v1 = _mm_rcp_ps(a.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_round_pd(__m256d __a, int __rounding) {
  __m256d_internal ret, a;
  a = __m256d_to_internal(__a);
  ret.v0 = _mm_round_pd(a.v0, __rounding);
  ret.v1 = _mm_round_pd(a.v1, __rounding);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_round_ps(__m256 __a, int __rounding) {
  __m256_internal ret, a;
  a = __m256_to_internal(__a);
  ret.v0 = _mm_round_ps(a.v0, __rounding);
  ret.v1 = _mm_round_ps(a.v1, __rounding);
  return __m256_from_internal(ret);
}

#define _mm256_ceil_pd(V) _mm256_round_pd((V), _MM_FROUND_CEIL)
#define _mm256_floor_pd(V) _mm256_round_pd((V), _MM_FROUND_FLOOR)
#define _mm256_ceil_ps(V) _mm256_round_ps((V), _MM_FROUND_CEIL)
#define _mm256_floor_ps(V) _mm256_round_ps((V), _MM_FROUND_FLOOR)

static __inline__ __m256d
  __attribute__((__always_inline__, __nodebug__)) _mm256_and_pd(__m256d __a,
                                                                __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_and_pd(a.v0, b.v0);
  ret.v1 = _mm_and_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_and_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_and_ps(a.v0, b.v0);
  ret.v1 = _mm_and_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_andnot_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_andnot_pd(a.v0, b.v0);
  ret.v1 = _mm_andnot_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_andnot_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_andnot_ps(a.v0, b.v0);
  ret.v1 = _mm_andnot_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_or_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_or_pd(a.v0, b.v0);
  ret.v1 = _mm_or_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_or_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_or_ps(a.v0, b.v0);
  ret.v1 = _mm_or_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_xor_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_xor_pd(a.v0, b.v0);
  ret.v1 = _mm_xor_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_xor_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_xor_ps(a.v0, b.v0);
  ret.v1 = _mm_xor_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_hadd_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_hadd_pd(a.v0, b.v0);
  ret.v1 = _mm_hadd_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_hadd_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_hadd_ps(a.v0, b.v0);
  ret.v1 = _mm_hadd_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_hsub_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_hsub_pd(a.v0, b.v0);
  ret.v1 = _mm_hsub_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_hsub_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_hsub_ps(a.v0, b.v0);
  ret.v1 = _mm_hsub_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_permutevar_pd(__m128d __a, __m128i __c) {
  return (__m128d)wasm_f64x2_make(
    ((__f64x2)__a)[(wasm_i64x2_extract_lane(__c, 0) >> 1) & 1],
    ((__f64x2)__a)[(wasm_i64x2_extract_lane(__c, 1) >> 1) & 1]);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_permutevar_pd(__m256d __a, __m256i __c) {
  __m256d_internal ret, a;
  __m256i_internal c;
  a = __m256d_to_internal(__a);
  c = __m256i_to_internal(__c);
  ret.v0 = _mm_permutevar_pd(a.v0, c.v0);
  ret.v1 = _mm_permutevar_pd(a.v1, c.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_permutevar_ps(__m128 __a, __m128i __c) {
  return (__m128)wasm_f32x4_make(
    ((__f32x4)__a)[wasm_i32x4_extract_lane(__c, 0) & 3],
    ((__f32x4)__a)[wasm_i32x4_extract_lane(__c, 1) & 3],
    ((__f32x4)__a)[wasm_i32x4_extract_lane(__c, 2) & 3],
    ((__f32x4)__a)[wasm_i32x4_extract_lane(__c, 3) & 3]);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_permutevar_ps(__m256 __a, __m256i __c) {
  __m256_internal ret, a;
  __m256i_internal c;
  a = __m256_to_internal(__a);
  c = __m256i_to_internal(__c);
  ret.v0 = _mm_permutevar_ps(a.v0, c.v0);
  ret.v1 = _mm_permutevar_ps(a.v1, c.v1);
  return __m256_from_internal(ret);
}

#define _mm_permute_pd(__a, __imm)                                             \\
  ((__m128d)wasm_i64x2_shuffle(                                                \\
    (__m128d)(__a), (__m128d)(__a), ((__imm) & 1), (((__imm) >> 1) & 1)))

#define _mm256_permute_pd(__A, __imm)                                          \\
  __extension__({                                                              \\
    __m256d_internal __a = __m256d_to_internal(__A);                             \\
    _mm256_set_m128d(_mm_permute_pd(__a.v1, (__imm) >> 2),                     \\
                     _mm_permute_pd(__a.v0, (__imm)));                         \\
  })

#define _mm_permute_ps(__a, __imm)                                             \\
  ((__m128)wasm_i32x4_shuffle((__m128)(__a),                                   \\
                              (__m128)(__a),                                   \\
                              ((__imm) & 3),                                   \\
                              (((__imm) >> 2) & 3),                            \\
                              (((__imm) >> 4) & 3),                            \\
                              (((__imm) >> 6) & 3)))

#define _mm256_permute_ps(__A, __imm)                                          \\
  __extension__({                                                              \\
    __m256_internal __a = __m256_to_internal(__A);                               \\
    _mm256_set_m128(_mm_permute_ps(__a.v1, (__imm)),                           \\
                    _mm_permute_ps(__a.v0, (__imm)));                          \\
  })

static __inline__ __m128d
__avx_select4d(__m256d __a, __m256d __b, const int imm8) {
  __m256d_internal a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  switch (imm8 & 0xF) {
    case 0:
    case 4:
      return a.v0;
    case 1:
    case 5:
      return a.v1;
    case 2:
    case 6:
      return b.v0;
    case 3:
    case 7:
      return b.v1;
    default:
      return (__m128d)wasm_i64x2_const_splat(0);
  }
}

static __inline__ __m128 __avx_select4(__m256 __a, __m256 __b, const int imm8) {
  __m256_internal a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  switch (imm8 & 0xF) {
    case 0:
    case 4:
      return a.v0;
    case 1:
    case 5:
      return a.v1;
    case 2:
    case 6:
      return b.v0;
    case 3:
    case 7:
      return b.v1;
    default:
      return (__m128)wasm_i64x2_const_splat(0);
  }
}

static __inline__ __m128i
__avx_select4i(__m256i __a, __m256i __b, const int imm8) {
  __m256i_internal a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  switch (imm8 & 0xF) {
    case 0:
    case 4:
      return a.v0;
    case 1:
    case 5:
      return a.v1;
    case 2:
    case 6:
      return b.v0;
    case 3:
    case 7:
      return b.v1;
    default:
      return wasm_i64x2_const_splat(0);
  }
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_permute2f128_pd(__m256d __a, __m256d __b, const int imm8) {
  __m256d_internal ret;
  ret.v0 = __avx_select4d(__a, __b, imm8);
  ret.v1 = __avx_select4d(__a, __b, imm8 >> 4);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_permute2f128_ps(__m256 __a, __m256 __b, const int imm8) {
  __m256_internal ret;
  ret.v0 = __avx_select4(__a, __b, imm8);
  ret.v1 = __avx_select4(__a, __b, imm8 >> 4);
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_permute2f128_si256(__m256i __a, __m256i __b, const int imm8) {
  __m256i_internal ret;
  ret.v0 = __avx_select4i(__a, __b, imm8);
  ret.v1 = __avx_select4i(__a, __b, imm8 >> 4);
  return __m256i_from_internal(ret);
}

#define _mm256_blend_pd(__A, __B, imm8)                                        \\
  __extension__({                                                              \\
    __m256d_internal __a = __m256d_to_internal(__A);                             \\
    __m256d_internal __b = __m256d_to_internal(__B);                             \\
    _mm256_set_m128d(_mm_blend_pd(__a.v1, __b.v1, (imm8) >> 2),                \\
                     _mm_blend_pd(__a.v0, __b.v0, (imm8)));                    \\
  })

#define _mm256_blend_ps(__A, __B, imm)                                         \\
  __extension__({                                                              \\
    __m256_internal __a = __m256_to_internal(__A);                               \\
    __m256_internal __b = __m256_to_internal(__B);                               \\
    _mm256_set_m128(_mm_blend_ps(__a.v1, __b.v1, (imm) >> 4),                  \\
                    _mm_blend_ps(__a.v0, __b.v0, (imm)));                      \\
  })

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_blendv_pd(__m256d __a, __m256d __b, __m256d __c) {
  __m256d_internal ret, a, b, c;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  c = __m256d_to_internal(__c);
  ret.v0 = _mm_blendv_pd(a.v0, b.v0, c.v0);
  ret.v1 = _mm_blendv_pd(a.v1, b.v1, c.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_blendv_ps(__m256 __a, __m256 __b, __m256 __c) {
  __m256_internal ret, a, b, c;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  c = __m256_to_internal(__c);
  ret.v0 = _mm_blendv_ps(a.v0, b.v0, c.v0);
  ret.v1 = _mm_blendv_ps(a.v1, b.v1, c.v1);
  return __m256_from_internal(ret);
}

#define _mm256_dp_ps(__A, __B, imm)                                            \\
  __extension__({                                                              \\
    __m256_internal __a = __m256_to_internal(__A);                               \\
    __m256_internal __b = __m256_to_internal(__B);                               \\
    _mm256_set_m128(_mm_dp_ps(__a.v1, __b.v1, (imm)),                          \\
                    _mm_dp_ps(__a.v0, __b.v0, (imm)));                         \\
  })

#define _mm256_shuffle_ps(__A, __B, mask)                                      \\
  __extension__({                                                              \\
    __m256_internal __a = __m256_to_internal(__A);                               \\
    __m256_internal __b = __m256_to_internal(__B);                               \\
    _mm256_set_m128(_mm_shuffle_ps(__a.v1, __b.v1, (mask)),                    \\
                    _mm_shuffle_ps(__a.v0, __b.v0, (mask)));                   \\
  })

#define _mm256_shuffle_pd(__A, __B, mask)                                      \\
  __extension__({                                                              \\
    __m256d_internal __a = __m256d_to_internal(__A);                             \\
    __m256d_internal __b = __m256d_to_internal(__B);                             \\
    _mm256_set_m128d(_mm_shuffle_pd(__a.v1, __b.v1, (mask) >> 2),              \\
                     _mm_shuffle_pd(__a.v0, __b.v0, (mask)));                  \\
  })

#define _CMP_EQ_OQ 0
#define _CMP_LT_OS 1
#define _CMP_LE_OS 2
#define _CMP_UNORD_Q 3
#define _CMP_NEQ_UQ 4
#define _CMP_NLT_US 5
#define _CMP_NLE_US 6
#define _CMP_ORD_Q 7
#define _CMP_EQ_UQ 8
#define _CMP_NGE_US 9
#define _CMP_NGT_US 10
#define _CMP_FALSE_OQ 11
#define _CMP_NEQ_OQ 12
#define _CMP_GE_OS 13
#define _CMP_GT_OS 14
#define _CMP_TRUE_UQ 15
#define _CMP_EQ_OS 16
#define _CMP_LT_OQ 17
#define _CMP_LE_OQ 18
#define _CMP_UNORD_S 19
#define _CMP_NEQ_US 20
#define _CMP_NLT_UQ 21
#define _CMP_NLE_UQ 22
#define _CMP_ORD_S 23
#define _CMP_EQ_US 24
#define _CMP_NGE_UQ 25
#define _CMP_NGT_UQ 26
#define _CMP_FALSE_OS 27
#define _CMP_NEQ_OS 28
#define _CMP_GE_OQ 29
#define _CMP_GT_OQ 30
#define _CMP_TRUE_US 31

#define _mm_cmp_pd(__a, __b, __imm)                                            \\
  __extension__({                                                              \\
    __m128d __ret;                                                             \\
    switch ((__imm)) {                                                         \\
      case _CMP_EQ_OQ:                                                         \\
      case _CMP_EQ_OS:                                                         \\
        __ret = _mm_cmpeq_pd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_EQ_UQ:                                                         \\
      case _CMP_EQ_US:                                                         \\
        __ret = _mm_or_pd(_mm_cmpeq_pd((__a), (__b)),                          \\
                          _mm_cmpunord_pd((__a), (__b)));                      \\
        break;                                                                 \\
      case _CMP_LT_OS:                                                         \\
      case _CMP_LT_OQ:                                                         \\
        __ret = _mm_cmplt_pd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_LE_OS:                                                         \\
      case _CMP_LE_OQ:                                                         \\
        __ret = _mm_cmple_pd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_UNORD_Q:                                                       \\
      case _CMP_UNORD_S:                                                       \\
        __ret = _mm_cmpunord_pd((__a), (__b));                                 \\
        break;                                                                 \\
      case _CMP_NEQ_UQ:                                                        \\
      case _CMP_NEQ_US:                                                        \\
        __ret = _mm_cmpneq_pd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NEQ_OQ:                                                        \\
      case _CMP_NEQ_OS:                                                        \\
        __ret = _mm_andnot_pd(_mm_cmpunord_pd((__a), (__b)),                   \\
                              _mm_cmpneq_pd((__a), (__b)));                    \\
        break;                                                                 \\
      case _CMP_NLT_US:                                                        \\
      case _CMP_NLT_UQ:                                                        \\
        __ret = _mm_cmpnlt_pd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_ORD_Q:                                                         \\
      case _CMP_ORD_S:                                                         \\
        __ret = _mm_cmpord_pd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGE_US:                                                        \\
      case _CMP_NGE_UQ:                                                        \\
        __ret = _mm_cmpnge_pd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGT_US:                                                        \\
      case _CMP_NGT_UQ:                                                        \\
        __ret = _mm_cmpngt_pd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_FALSE_OQ:                                                      \\
      case _CMP_FALSE_OS:                                                      \\
        __ret = _mm_setzero_pd();                                              \\
        break;                                                                 \\
      case _CMP_GE_OS:                                                         \\
      case _CMP_GE_OQ:                                                         \\
        __ret = _mm_cmpge_pd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_GT_OS:                                                         \\
      case _CMP_GT_OQ:                                                         \\
        __ret = _mm_cmpgt_pd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_TRUE_UQ:                                                       \\
      case _CMP_TRUE_US:                                                       \\
        __ret = (__m128d)wasm_i8x16_splat(0xFF);                               \\
        break;                                                                 \\
      case _CMP_NLE_US:                                                        \\
      case _CMP_NLE_UQ:                                                        \\
        __ret = _mm_cmpnle_pd((__a), (__b));                                   \\
        break;                                                                 \\
    }                                                                          \\
    __ret;                                                                     \\
  })

#define _mm_cmp_ps(__a, __b, __imm)                                            \\
  __extension__({                                                              \\
    __m128 __ret;                                                              \\
    switch ((__imm)) {                                                         \\
      case _CMP_EQ_OQ:                                                         \\
      case _CMP_EQ_OS:                                                         \\
        __ret = _mm_cmpeq_ps((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_EQ_UQ:                                                         \\
      case _CMP_EQ_US:                                                         \\
        __ret = _mm_or_ps(_mm_cmpeq_ps((__a), (__b)),                          \\
                          _mm_cmpunord_ps((__a), (__b)));                      \\
        break;                                                                 \\
      case _CMP_LT_OS:                                                         \\
      case _CMP_LT_OQ:                                                         \\
        __ret = _mm_cmplt_ps((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_LE_OS:                                                         \\
      case _CMP_LE_OQ:                                                         \\
        __ret = _mm_cmple_ps((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_UNORD_Q:                                                       \\
      case _CMP_UNORD_S:                                                       \\
        __ret = _mm_cmpunord_ps((__a), (__b));                                 \\
        break;                                                                 \\
      case _CMP_NEQ_UQ:                                                        \\
      case _CMP_NEQ_US:                                                        \\
        __ret = _mm_cmpneq_ps((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NEQ_OQ:                                                        \\
      case _CMP_NEQ_OS:                                                        \\
        __ret = _mm_andnot_ps(_mm_cmpunord_ps((__a), (__b)),                   \\
                              _mm_cmpneq_ps((__a), (__b)));                    \\
        break;                                                                 \\
      case _CMP_NLT_US:                                                        \\
      case _CMP_NLT_UQ:                                                        \\
        __ret = _mm_cmpnlt_ps((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_ORD_Q:                                                         \\
      case _CMP_ORD_S:                                                         \\
        __ret = _mm_cmpord_ps((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGE_US:                                                        \\
      case _CMP_NGE_UQ:                                                        \\
        __ret = _mm_cmpnge_ps((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGT_US:                                                        \\
      case _CMP_NGT_UQ:                                                        \\
        __ret = _mm_cmpngt_ps((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_FALSE_OQ:                                                      \\
      case _CMP_FALSE_OS:                                                      \\
        __ret = _mm_setzero_ps();                                              \\
        break;                                                                 \\
      case _CMP_GE_OS:                                                         \\
      case _CMP_GE_OQ:                                                         \\
        __ret = _mm_cmpge_ps((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_GT_OS:                                                         \\
      case _CMP_GT_OQ:                                                         \\
        __ret = _mm_cmpgt_ps((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_TRUE_UQ:                                                       \\
      case _CMP_TRUE_US:                                                       \\
        __ret = (__m128)wasm_i8x16_splat(0xFF);                                \\
        break;                                                                 \\
      case _CMP_NLE_US:                                                        \\
      case _CMP_NLE_UQ:                                                        \\
        __ret = _mm_cmpnle_ps((__a), (__b));                                   \\
        break;                                                                 \\
    }                                                                          \\
    __ret;                                                                     \\
  })

#define _mm_cmp_sd(__a, __b, __imm)                                            \\
  __extension__({                                                              \\
    __m128d __ret;                                                             \\
    switch ((__imm)) {                                                         \\
      case _CMP_EQ_OQ:                                                         \\
      case _CMP_EQ_OS:                                                         \\
        __ret = _mm_cmpeq_sd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_EQ_UQ:                                                         \\
      case _CMP_EQ_US:                                                         \\
        __ret = _mm_move_sd((__a),                                             \\
                            _mm_or_pd(_mm_cmpeq_sd((__a), (__b)),              \\
                                      _mm_cmpunord_sd((__a), (__b))));         \\
        break;                                                                 \\
      case _CMP_LT_OS:                                                         \\
      case _CMP_LT_OQ:                                                         \\
        __ret = _mm_cmplt_sd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_LE_OS:                                                         \\
      case _CMP_LE_OQ:                                                         \\
        __ret = _mm_cmple_sd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_UNORD_Q:                                                       \\
      case _CMP_UNORD_S:                                                       \\
        __ret = _mm_cmpunord_sd((__a), (__b));                                 \\
        break;                                                                 \\
      case _CMP_NEQ_UQ:                                                        \\
      case _CMP_NEQ_US:                                                        \\
        __ret = _mm_cmpneq_sd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NEQ_OQ:                                                        \\
      case _CMP_NEQ_OS:                                                        \\
        __ret = _mm_move_sd((__a),                                             \\
                            _mm_andnot_pd(_mm_cmpunord_sd((__a), (__b)),       \\
                                          _mm_cmpneq_sd((__a), (__b))));       \\
        break;                                                                 \\
      case _CMP_NLT_US:                                                        \\
      case _CMP_NLT_UQ:                                                        \\
        __ret = _mm_cmpnlt_sd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_ORD_Q:                                                         \\
      case _CMP_ORD_S:                                                         \\
        __ret = _mm_cmpord_sd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGE_US:                                                        \\
      case _CMP_NGE_UQ:                                                        \\
        __ret = _mm_cmpnge_sd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGT_US:                                                        \\
      case _CMP_NGT_UQ:                                                        \\
        __ret = _mm_cmpngt_sd((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_FALSE_OQ:                                                      \\
      case _CMP_FALSE_OS:                                                      \\
        __ret = _mm_move_sd((__a), _mm_setzero_pd());                          \\
        break;                                                                 \\
      case _CMP_GE_OS:                                                         \\
      case _CMP_GE_OQ:                                                         \\
        __ret = _mm_cmpge_sd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_GT_OS:                                                         \\
      case _CMP_GT_OQ:                                                         \\
        __ret = _mm_cmpgt_sd((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_TRUE_UQ:                                                       \\
      case _CMP_TRUE_US:                                                       \\
        __ret = _mm_move_sd((__a), (__m128d)wasm_i8x16_splat(0xFF));           \\
        break;                                                                 \\
      case _CMP_NLE_US:                                                        \\
      case _CMP_NLE_UQ:                                                        \\
        __ret = _mm_cmpnle_sd((__a), (__b));                                   \\
        break;                                                                 \\
    }                                                                          \\
    __ret;                                                                     \\
  })

#define _mm_cmp_ss(__a, __b, __imm)                                            \\
  __extension__({                                                              \\
    __m128 __ret;                                                              \\
    switch ((__imm)) {                                                         \\
      case _CMP_EQ_OQ:                                                         \\
      case _CMP_EQ_OS:                                                         \\
        __ret = _mm_cmpeq_ss((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_EQ_UQ:                                                         \\
      case _CMP_EQ_US:                                                         \\
        __ret = _mm_move_ss((__a),                                             \\
                            _mm_or_ps(_mm_cmpeq_ss((__a), (__b)),              \\
                                      _mm_cmpunord_ss((__a), (__b))));         \\
        break;                                                                 \\
      case _CMP_LT_OS:                                                         \\
      case _CMP_LT_OQ:                                                         \\
        __ret = _mm_cmplt_ss((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_LE_OS:                                                         \\
      case _CMP_LE_OQ:                                                         \\
        __ret = _mm_cmple_ss((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_UNORD_Q:                                                       \\
      case _CMP_UNORD_S:                                                       \\
        __ret = _mm_cmpunord_ss((__a), (__b));                                 \\
        break;                                                                 \\
      case _CMP_NEQ_UQ:                                                        \\
      case _CMP_NEQ_US:                                                        \\
        __ret = _mm_cmpneq_ss((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NEQ_OQ:                                                        \\
      case _CMP_NEQ_OS:                                                        \\
        __ret = _mm_move_ss((__a),                                             \\
                            _mm_andnot_ps(_mm_cmpunord_ss((__a), (__b)),       \\
                                          _mm_cmpneq_ss((__a), (__b))));       \\
        break;                                                                 \\
      case _CMP_NLT_US:                                                        \\
      case _CMP_NLT_UQ:                                                        \\
        __ret = _mm_cmpnlt_ss((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_ORD_Q:                                                         \\
      case _CMP_ORD_S:                                                         \\
        __ret = _mm_cmpord_ss((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGE_US:                                                        \\
      case _CMP_NGE_UQ:                                                        \\
        __ret = _mm_cmpnge_ss((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_NGT_US:                                                        \\
      case _CMP_NGT_UQ:                                                        \\
        __ret = _mm_cmpngt_ss((__a), (__b));                                   \\
        break;                                                                 \\
      case _CMP_FALSE_OQ:                                                      \\
      case _CMP_FALSE_OS:                                                      \\
        __ret = _mm_move_ss((__a), _mm_setzero_ps());                          \\
        break;                                                                 \\
      case _CMP_GE_OS:                                                         \\
      case _CMP_GE_OQ:                                                         \\
        __ret = _mm_cmpge_ss((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_GT_OS:                                                         \\
      case _CMP_GT_OQ:                                                         \\
        __ret = _mm_cmpgt_ss((__a), (__b));                                    \\
        break;                                                                 \\
      case _CMP_TRUE_UQ:                                                       \\
      case _CMP_TRUE_US:                                                       \\
        __ret = _mm_move_ss((__a), (__m128)wasm_i8x16_splat(0xFF));            \\
        break;                                                                 \\
      case _CMP_NLE_US:                                                        \\
      case _CMP_NLE_UQ:                                                        \\
        __ret = _mm_cmpnle_ss((__a), (__b));                                   \\
        break;                                                                 \\
    }                                                                          \\
    __ret;                                                                     \\
  })

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_cmp_pd(__m256d __a, __m256d __b, const int imm8) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_cmp_pd(a.v0, b.v0, imm8);
  ret.v1 = _mm_cmp_pd(a.v1, b.v1, imm8);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_cmp_ps(__m256 __a, __m256 __b, const int imm8) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_cmp_ps(a.v0, b.v0, imm8);
  ret.v1 = _mm_cmp_ps(a.v1, b.v1, imm8);
  return __m256_from_internal(ret);
}

#define _mm256_extract_epi32(__A, N)                                           \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    ((N) & 0x7) < 4 ? _mm_extract_epi32(__a.v0, (N) & 0x3)                     \\
                    : _mm_extract_epi32(__a.v1, (N) & 0x3);                    \\
  })

#define _mm256_extract_epi16(__A, N)                                           \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    ((N) & 0xF) < 8 ? _mm_extract_epi16(__a.v0, (N) & 0x7)                     \\
                    : _mm_extract_epi16(__a.v1, (N) & 0x7);                    \\
  })

#define _mm256_extract_epi8(__A, N)                                            \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    ((N) & 0x1F) < 16 ? _mm_extract_epi8(__a.v0, (N) & 0xF)                    \\
                      : _mm_extract_epi8(__a.v1, (N) & 0xF);                   \\
  })

#define _mm256_extract_epi64(__A, N)                                           \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    ((N) & 0x3) < 2 ? _mm_extract_epi64(__a.v0, (N) & 0x1)                     \\
                    : _mm_extract_epi64(__a.v1, (N) & 0x1);                    \\
  })

#define _mm256_insert_epi32(__A, __I, N)                                       \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    int32_t __i = (__I);                                                       \\
    ((N) & 0x7) < 4                                                            \\
      ? _mm256_set_m128i(__a.v1, _mm_insert_epi32(__a.v0, __i, (N) & 0x3))     \\
      : _mm256_set_m128i(_mm_insert_epi32(__a.v1, __i, (N) & 0x3), __a.v0);    \\
  })

#define _mm256_insert_epi16(__A, __I, N)                                       \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    int16_t __i = (__I);                                                       \\
    ((N) & 0xF) < 8                                                            \\
      ? _mm256_set_m128i(__a.v1, _mm_insert_epi16(__a.v0, __i, (N) & 0x7))     \\
      : _mm256_set_m128i(_mm_insert_epi16(__a.v1, __i, (N) & 0x7), __a.v0);    \\
  })

#define _mm256_insert_epi8(__A, __I, N)                                        \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    int8_t __i = (__I);                                                        \\
    ((N) & 0x1F) < 16                                                          \\
      ? _mm256_set_m128i(__a.v1, _mm_insert_epi8(__a.v0, __i, (N) & 0xF))      \\
      : _mm256_set_m128i(_mm_insert_epi8(__a.v1, __i, (N) & 0xF), __a.v0);     \\
  })

#define _mm256_insert_epi64(__A, __I, N)                                       \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    int64_t __i = (__I);                                                       \\
    ((N) & 0x3) < 2                                                            \\
      ? _mm256_set_m128i(__a.v1, _mm_insert_epi64(__a.v0, __i, (N) & 0x1))     \\
      : _mm256_set_m128i(_mm_insert_epi64(__a.v1, __i, (N) & 0x1), __a.v0);    \\
  })

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi32_pd(__m128i __a) {
  __m256d_internal ret;
  ret.v0 = _mm_cvtepi32_pd(__a);
  __m128i __a1 = wasm_i32x4_shuffle(__a, __a, 2, 3, 0, 0);
  ret.v1 = _mm_cvtepi32_pd(__a1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi32_ps(__m256i __a) {
  __m256_internal ret;
  __m256i_internal a = __m256i_to_internal(__a);
  ret.v0 = _mm_cvtepi32_ps(a.v0);
  ret.v1 = _mm_cvtepi32_ps(a.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm256_cvtpd_ps(__m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  __m128 low = _mm_cvtpd_ps(a.v0);
  __m128 high = _mm_cvtpd_ps(a.v1);
  __m128 ret = (__m128)wasm_i32x4_shuffle(low, high, 0, 1, 4, 5);
  return ret;
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtps_epi32(__m256 __a) {
  __m256i_internal ret;
  __m256_internal a = __m256_to_internal(__a);
  ret.v0 = _mm_cvtps_epi32(a.v0);
  ret.v1 = _mm_cvtps_epi32(a.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_cvtps_pd(__m128 __a) {
  __m256d_internal ret;
  ret.v0 = _mm_cvtps_pd(__a);
  __m128 __a1 = (__m128)wasm_i32x4_shuffle(__a, __a, 2, 3, 0, 0);
  ret.v1 = _mm_cvtps_pd(__a1);
  return __m256d_from_internal(ret);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm256_cvttpd_epi32(__m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  __m128i low = _mm_cvttpd_epi32(a.v0);
  __m128i high = _mm_cvttpd_epi32(a.v1);
  __m128i ret = wasm_i32x4_shuffle(low, high, 0, 1, 4, 5);
  return ret;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtpd_epi32(__m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  __m128i low = _mm_cvtpd_epi32(a.v0);
  __m128i high = _mm_cvtpd_epi32(a.v1);
  __m128i ret = wasm_i32x4_shuffle(low, high, 0, 1, 4, 5);
  return ret;
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvttps_epi32(__m256 __a) {
  __m256i_internal ret;
  __m256_internal a = __m256_to_internal(__a);
  ret.v0 = _mm_cvttps_epi32(a.v0);
  ret.v1 = _mm_cvttps_epi32(a.v1);
  return __m256i_from_internal(ret);
}

static __inline__ double __attribute__((__always_inline__, __nodebug__))
_mm256_cvtsd_f64(__m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  return _mm_cvtsd_f64(a.v0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_cvtsi256_si32(__m256i __a) {
  __m256i_internal a = __m256i_to_internal(__a);
  return _mm_cvtsi128_si32(a.v0);
}

static __inline__ float __attribute__((__always_inline__, __nodebug__))
_mm256_cvtss_f32(__m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  return _mm_cvtss_f32(a.v0);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_movehdup_ps(__m256 __a) {
  __m256_internal ret, a;
  a = __m256_to_internal(__a);
  ret.v0 = _mm_movehdup_ps(a.v0);
  ret.v1 = _mm_movehdup_ps(a.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_moveldup_ps(__m256 __a) {
  __m256_internal ret, a;
  a = __m256_to_internal(__a);
  ret.v0 = _mm_moveldup_ps(a.v0);
  ret.v1 = _mm_moveldup_ps(a.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_movedup_pd(__m256d __a) {
  __m256d_internal ret, a;
  a = __m256d_to_internal(__a);
  ret.v0 = _mm_movedup_pd(a.v0);
  ret.v1 = _mm_movedup_pd(a.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_unpackhi_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_unpackhi_pd(a.v0, b.v0);
  ret.v1 = _mm_unpackhi_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_unpacklo_pd(__m256d __a, __m256d __b) {
  __m256d_internal ret, a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  ret.v0 = _mm_unpacklo_pd(a.v0, b.v0);
  ret.v1 = _mm_unpacklo_pd(a.v1, b.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_unpackhi_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_unpackhi_ps(a.v0, b.v0);
  ret.v1 = _mm_unpackhi_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_unpacklo_ps(__m256 __a, __m256 __b) {
  __m256_internal ret, a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  ret.v0 = _mm_unpacklo_ps(a.v0, b.v0);
  ret.v1 = _mm_unpacklo_ps(a.v1, b.v1);
  return __m256_from_internal(ret);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testz_pd(__m128d __a, __m128d __b) {
  v128_t __m =
    wasm_u64x2_shr(wasm_v128_not(wasm_v128_and((v128_t)__a, (v128_t)__b)), 63);
  return wasm_i64x2_extract_lane(__m, 0) & wasm_i64x2_extract_lane(__m, 1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testc_pd(__m128d __a, __m128d __b) {
  v128_t __m =
    wasm_u64x2_shr(wasm_v128_or(wasm_v128_not((v128_t)__b), (v128_t)__a), 63);
  return wasm_i64x2_extract_lane(__m, 0) & wasm_i64x2_extract_lane(__m, 1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testnzc_pd(__m128d __a, __m128d __b) {
  v128_t __m = wasm_u64x2_shr(wasm_v128_and((v128_t)__a, (v128_t)__b), 63);
  v128_t __m2 = wasm_u64x2_shr(wasm_v128_andnot((v128_t)__b, (v128_t)__a), 63);
  return (wasm_i64x2_extract_lane(__m, 0) | wasm_i64x2_extract_lane(__m, 1)) &
         (wasm_i64x2_extract_lane(__m2, 0) | wasm_i64x2_extract_lane(__m2, 1));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testz_ps(__m128 __a, __m128 __b) {
  v128_t __m =
    wasm_u32x4_shr(wasm_v128_not(wasm_v128_and((v128_t)__a, (v128_t)__b)), 31);
  __m = wasm_v128_and(__m, (v128_t)_mm_movehl_ps((__m128)__m, (__m128)__m));
  __m = wasm_v128_and(__m, _mm_shuffle_epi32(__m, _MM_SHUFFLE(3, 2, 0, 1)));
  return wasm_i32x4_extract_lane(__m, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testc_ps(__m128 __a, __m128 __b) {
  v128_t __m =
    wasm_u32x4_shr(wasm_v128_or(wasm_v128_not((v128_t)__b), (v128_t)__a), 31);
  __m = wasm_v128_and(__m, (v128_t)_mm_movehl_ps((__m128)__m, (__m128)__m));
  __m = wasm_v128_and(__m, _mm_shuffle_epi32(__m, _MM_SHUFFLE(3, 2, 0, 1)));
  return wasm_i32x4_extract_lane(__m, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm_testnzc_ps(__m128 __a, __m128 __b) {
  v128_t __m = wasm_u32x4_shr(wasm_v128_and((v128_t)__a, (v128_t)__b), 31);
  v128_t __m2 = wasm_u32x4_shr(wasm_v128_andnot((v128_t)__b, (v128_t)__a), 31);

  __m = wasm_v128_or(__m, (v128_t)_mm_movehl_ps((__m128)__m, (__m128)__m));
  __m2 = wasm_v128_or(__m2, (v128_t)_mm_movehl_ps((__m128)__m2, (__m128)__m2));
  __m = wasm_v128_or(__m, _mm_shuffle_epi32(__m, _MM_SHUFFLE(3, 2, 0, 1)));
  __m2 = wasm_v128_or(__m2, _mm_shuffle_epi32(__m2, _MM_SHUFFLE(3, 2, 0, 1)));

  return wasm_i32x4_extract_lane(__m, 0) & wasm_i32x4_extract_lane(__m2, 0);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testz_pd(__m256d __a, __m256d __b) {
  __m256d_internal a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  return _mm_testz_pd(a.v0, b.v0) & _mm_testz_pd(a.v1, b.v1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testc_pd(__m256d __a, __m256d __b) {
  __m256d_internal a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  return _mm_testc_pd(a.v0, b.v0) & _mm_testc_pd(a.v1, b.v1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testnzc_pd(__m256d __a, __m256d __b) {
  __m256d_internal a, b;
  a = __m256d_to_internal(__a);
  b = __m256d_to_internal(__b);
  v128_t __m =
    wasm_u64x2_shr(wasm_v128_and((v128_t)a.v0, (v128_t)b.v0), 63);
  v128_t __m1 =
    wasm_u64x2_shr(wasm_v128_and((v128_t)a.v1, (v128_t)b.v1), 63);
  v128_t __m2 =
    wasm_u64x2_shr(wasm_v128_andnot((v128_t)b.v0, (v128_t)a.v0), 63);
  v128_t __m3 =
    wasm_u64x2_shr(wasm_v128_andnot((v128_t)b.v1, (v128_t)a.v1), 63);
  return wasm_v128_any_true(wasm_v128_or(__m, __m1)) &
         wasm_v128_any_true(wasm_v128_or(__m2, __m3));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testz_ps(__m256 __a, __m256 __b) {
  __m256_internal a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  return _mm_testz_ps(a.v0, b.v0) & _mm_testz_ps(a.v1, b.v1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testc_ps(__m256 __a, __m256 __b) {
  __m256_internal a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  return _mm_testc_ps(a.v0, b.v0) & _mm_testc_ps(a.v1, b.v1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testnzc_ps(__m256 __a, __m256 __b) {
  __m256_internal a, b;
  a = __m256_to_internal(__a);
  b = __m256_to_internal(__b);
  v128_t __m =
    wasm_u32x4_shr(wasm_v128_and((v128_t)a.v0, (v128_t)b.v0), 31);
  v128_t __m1 =
    wasm_u32x4_shr(wasm_v128_and((v128_t)a.v1, (v128_t)b.v1), 31);
  v128_t __m2 =
    wasm_u32x4_shr(wasm_v128_andnot((v128_t)b.v0, (v128_t)a.v0), 31);
  v128_t __m3 =
    wasm_u32x4_shr(wasm_v128_andnot((v128_t)b.v1, (v128_t)a.v1), 31);

  return wasm_v128_any_true(wasm_v128_or(__m, __m1)) &
         wasm_v128_any_true(wasm_v128_or(__m2, __m3));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testz_si256(__m256i __a, __m256i __b) {
  __m256i_internal a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  return _mm_testz_si128(a.v0, b.v0) & _mm_testz_si128(a.v1, b.v1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testc_si256(__m256i __a, __m256i __b) {
  __m256i_internal a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  return _mm_testc_si128(a.v0, b.v0) & _mm_testc_si128(a.v1, b.v1);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_testnzc_si256(__m256i __a, __m256i __b) {
  __m256i_internal a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  v128_t __m = wasm_v128_and(a.v0, b.v0);
  v128_t __m1 = wasm_v128_and(a.v1, b.v1);
  v128_t __m2 = wasm_v128_andnot(b.v0, a.v0);
  v128_t __m3 = wasm_v128_andnot(b.v1, a.v1);
  return wasm_v128_any_true(wasm_v128_or(__m, __m1)) &
         wasm_v128_any_true(wasm_v128_or(__m2, __m3));
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_movemask_pd(__m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  return _mm_movemask_pd(a.v0) | (_mm_movemask_pd(a.v1) << 2);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_movemask_ps(__m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  return _mm_movemask_ps(a.v0) | (_mm_movemask_ps(a.v1) << 4);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_zeroall(void) {
  // Do nothing
  // when porting any assembly code that would have calls to these functions
  // around, that assembly code in the first place will not compile.
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_zeroupper(void) {
  // Do nothing
  // when porting any assembly code that would have calls to these functions
  // around, that assembly code in the first place will not compile.
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_broadcast_ss(float const* __a) {
  return (__m128)wasm_v128_load32_splat(__a);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_broadcast_sd(double const* __a) {
  __m256d_internal ret;
  ret.v1 = ret.v0 = (__m128d)wasm_v128_load64_splat(__a);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_broadcast_ss(float const* __a) {
  __m256_internal ret;
  ret.v1 = ret.v0 = _mm_broadcast_ss(__a);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_broadcast_pd(__m128d const* __a) {
  __m256d_internal ret;
  ret.v1 = ret.v0 = (__m128d)wasm_v128_load(__a);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_broadcast_ps(__m128 const* __a) {
  __m256_internal ret;
  ret.v1 = ret.v0 = (__m128)wasm_v128_load(__a);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_load_pd(double const* __p) {
  __m256d_internal ret;
  ret.v0 = _mm_load_pd(__p);
  ret.v1 = _mm_load_pd(__p + 2);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_load_ps(float const* __p) {
  __m256_internal ret;
  ret.v0 = _mm_load_ps(__p);
  ret.v1 = _mm_load_ps(__p + 4);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_loadu_pd(double const* __p) {
  __m256d_internal ret;
  ret.v0 = _mm_loadu_pd(__p);
  ret.v1 = _mm_loadu_pd(__p + 2);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_loadu_ps(float const* __p) {
  __m256_internal ret;
  ret.v0 = _mm_loadu_ps(__p);
  ret.v1 = _mm_loadu_ps(__p + 4);
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_load_si256(__m256i const* __p) {
  __m256i_internal ret;
  ret.v0 = _mm_load_si128((__m128i const*)__p);
  ret.v1 = _mm_load_si128(((__m128i const*)__p) + 1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_loadu_si256(__m256i_u const* __p) {
  __m256i_internal ret;
  ret.v0 = _mm_loadu_si128((__m128i const*)__p);
  ret.v1 = _mm_loadu_si128(((__m128i const*)__p) + 1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_lddqu_si256(__m256i_u const* __p) {
  __m256i_internal ret;
  ret.v0 = _mm_lddqu_si128((__m128i const*)__p);
  ret.v1 = _mm_lddqu_si128(((__m128i const*)__p) + 1);
  return __m256i_from_internal(ret);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_store_pd(double* __p, __m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  _mm_store_pd(__p, a.v0);
  _mm_store_pd(__p + 2, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_store_ps(float* __p, __m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  _mm_store_ps(__p, a.v0);
  _mm_store_ps(__p + 4, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_storeu_pd(double* __p, __m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  _mm_storeu_pd(__p, a.v0);
  _mm_storeu_pd(__p + 2, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_storeu_ps(float* __p, __m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  _mm_storeu_ps(__p, a.v0);
  _mm_storeu_ps(__p + 4, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_store_si256(__m256i* __p, __m256i __a) {
  __m256i_internal a = __m256i_to_internal(__a);
  _mm_store_si128((__m128i*)__p, a.v0);
  _mm_store_si128(((__m128i*)__p) + 1, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_storeu_si256(__m256i_u* __p, __m256i __a) {
  __m256i_internal a = __m256i_to_internal(__a);
  _mm_storeu_si128((__m128i*)__p, a.v0);
  _mm_storeu_si128(((__m128i*)__p) + 1, a.v1);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_maskload_pd(double const* __p, __m128i __m) {
  // This may cause an out-of-bounds memory load since we first load and
  // then mask, but since there are no segmentation faults in Wasm memory
  // accesses, that is ok (as long as we are within the heap bounds -
  // a negligible limitation in practice)
  return _mm_and_pd(_mm_load_pd(__p), (__m128d)wasm_i64x2_shr(__m, 63));
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_maskload_pd(double const* __p, __m256i __m) {
  __m256d_internal ret;
  __m256i_internal m = __m256i_to_internal(__m);
  ret.v0 = _mm_maskload_pd(__p, m.v0);
  ret.v1 = _mm_maskload_pd(__p + 2, m.v1);
  return __m256d_from_internal(ret);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_maskload_ps(float const* __p, __m128i __m) {
  // This may cause an out-of-bounds memory load since we first load and
  // then mask, but since there are no segmentation faults in Wasm memory
  // accesses, that is ok (as long as we are within the heap bounds -
  // a negligible limitation in practice)
  return _mm_and_ps(_mm_load_ps(__p), (__m128)_mm_srai_epi32(__m, 31));
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_maskload_ps(float const* __p, __m256i __m) {
  __m256_internal ret;
  __m256i_internal m = __m256i_to_internal(__m);
  ret.v0 = _mm_maskload_ps(__p, m.v0);
  ret.v1 = _mm_maskload_ps(__p + 4, m.v1);
  return __m256_from_internal(ret);
}

static __inline__ void
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_maskstore_ps(float* __p, __m128i __m, __m128 __a) {
  if ((wasm_i32x4_extract_lane(__m, 0) & 0x80000000ull) != 0)
    __p[0] = wasm_f32x4_extract_lane((v128_t)__a, 0);
  if ((wasm_i32x4_extract_lane(__m, 1) & 0x80000000ull) != 0)
    __p[1] = wasm_f32x4_extract_lane((v128_t)__a, 1);
  if ((wasm_i32x4_extract_lane(__m, 2) & 0x80000000ull) != 0)
    __p[2] = wasm_f32x4_extract_lane((v128_t)__a, 2);
  if ((wasm_i32x4_extract_lane(__m, 3) & 0x80000000ull) != 0)
    __p[3] = wasm_f32x4_extract_lane((v128_t)__a, 3);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_maskstore_ps(float* __p, __m256i __m, __m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  __m256i_internal m = __m256i_to_internal(__m);
  _mm_maskstore_ps(__p, m.v0, a.v0);
  _mm_maskstore_ps(__p + 4, m.v1, a.v1);
}

static __inline__ void
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_maskstore_pd(double* __p, __m128i __m, __m128d __a) {
  if ((wasm_i64x2_extract_lane(__m, 0) & 0x8000000000000000ull) != 0)
    __p[0] = wasm_f64x2_extract_lane((v128_t)__a, 0);
  if ((wasm_i64x2_extract_lane(__m, 1) & 0x8000000000000000ull) != 0)
    __p[1] = wasm_f64x2_extract_lane((v128_t)__a, 1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_maskstore_pd(double* __p, __m256i __m, __m256d __a) {
  __m256i_internal m = __m256i_to_internal(__m);
  __m256d_internal a = __m256d_to_internal(__a);
  _mm_maskstore_pd(__p, m.v0, a.v0);
  _mm_maskstore_pd(__p + 2, m.v1, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_stream_si256(void* __a, __m256i __b) {
  __m256i_internal b = __m256i_to_internal(__b);
  _mm_stream_si128((__m128i*)__a, b.v0);
  _mm_stream_si128(((__m128i*)__a) + 1, b.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_stream_pd(void* __a, __m256d __b) {
  __m256d_internal b = __m256d_to_internal(__b);
  _mm_stream_pd((double*)__a, b.v0);
  _mm_stream_pd(((double*)__a) + 2, b.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_stream_ps(void* __p, __m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  _mm_stream_ps((float*)__p, a.v0);
  _mm_stream_ps(((float*)__p) + 4, a.v1);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_undefined_pd(void) {
  __m256d val;
  return val;
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_undefined_ps(void) {
  __m256 val;
  return val;
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_undefined_si256(void) {
  __m256i val;
  return val;
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_set_pd(double __a, double __b, double __c, double __d) {
  __m256d_internal ret;
  ret.v0 = _mm_set_pd(__c, __d);
  ret.v1 = _mm_set_pd(__a, __b);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_set_ps(float __a,
              float __b,
              float __c,
              float __d,
              float __e,
              float __f,
              float __g,
              float __h) {
  __m256_internal ret;
  ret.v0 = _mm_set_ps(__e, __f, __g, __h);
  ret.v1 = _mm_set_ps(__a, __b, __c, __d);
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set_epi32(int __i0,
                 int __i1,
                 int __i2,
                 int __i3,
                 int __i4,
                 int __i5,
                 int __i6,
                 int __i7) {
  __m256i_internal ret;
  ret.v0 = _mm_set_epi32(__i4, __i5, __i6, __i7);
  ret.v1 = _mm_set_epi32(__i0, __i1, __i2, __i3);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set_epi16(short __w15,
                 short __w14,
                 short __w13,
                 short __w12,
                 short __w11,
                 short __w10,
                 short __w09,
                 short __w08,
                 short __w07,
                 short __w06,
                 short __w05,
                 short __w04,
                 short __w03,
                 short __w02,
                 short __w01,
                 short __w00) {
  __m256i_internal ret;
  ret.v0 =
    _mm_set_epi16(__w07, __w06, __w05, __w04, __w03, __w02, __w01, __w00);
  ret.v1 =
    _mm_set_epi16(__w15, __w14, __w13, __w12, __w11, __w10, __w09, __w08);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set_epi8(char __b31,
                char __b30,
                char __b29,
                char __b28,
                char __b27,
                char __b26,
                char __b25,
                char __b24,
                char __b23,
                char __b22,
                char __b21,
                char __b20,
                char __b19,
                char __b18,
                char __b17,
                char __b16,
                char __b15,
                char __b14,
                char __b13,
                char __b12,
                char __b11,
                char __b10,
                char __b09,
                char __b08,
                char __b07,
                char __b06,
                char __b05,
                char __b04,
                char __b03,
                char __b02,
                char __b01,
                char __b00) {
  __m256i_internal ret;
  ret.v0 = _mm_set_epi8(__b15,
                        __b14,
                        __b13,
                        __b12,
                        __b11,
                        __b10,
                        __b09,
                        __b08,
                        __b07,
                        __b06,
                        __b05,
                        __b04,
                        __b03,
                        __b02,
                        __b01,
                        __b00);
  ret.v1 = _mm_set_epi8(__b31,
                        __b30,
                        __b29,
                        __b28,
                        __b27,
                        __b26,
                        __b25,
                        __b24,
                        __b23,
                        __b22,
                        __b21,
                        __b20,
                        __b19,
                        __b18,
                        __b17,
                        __b16);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set_epi64x(long long __a, long long __b, long long __c, long long __d) {
  __m256i_internal ret;
  ret.v0 = _mm_set_epi64x(__c, __d);
  ret.v1 = _mm_set_epi64x(__a, __b);
  return __m256i_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_setr_pd(double __a, double __b, double __c, double __d) {
  return _mm256_set_pd(__d, __c, __b, __a);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_setr_ps(float __a,
               float __b,
               float __c,
               float __d,
               float __e,
               float __f,
               float __g,
               float __h) {
  return _mm256_set_ps(__h, __g, __f, __e, __d, __c, __b, __a);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_setr_epi32(int __i0,
                  int __i1,
                  int __i2,
                  int __i3,
                  int __i4,
                  int __i5,
                  int __i6,
                  int __i7) {
  return _mm256_set_epi32(__i7, __i6, __i5, __i4, __i3, __i2, __i1, __i0);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_setr_epi16(short __w15,
                  short __w14,
                  short __w13,
                  short __w12,
                  short __w11,
                  short __w10,
                  short __w09,
                  short __w08,
                  short __w07,
                  short __w06,
                  short __w05,
                  short __w04,
                  short __w03,
                  short __w02,
                  short __w01,
                  short __w00) {
  return _mm256_set_epi16(__w00,
                          __w01,
                          __w02,
                          __w03,
                          __w04,
                          __w05,
                          __w06,
                          __w07,
                          __w08,
                          __w09,
                          __w10,
                          __w11,
                          __w12,
                          __w13,
                          __w14,
                          __w15);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_setr_epi8(char __b31,
                 char __b30,
                 char __b29,
                 char __b28,
                 char __b27,
                 char __b26,
                 char __b25,
                 char __b24,
                 char __b23,
                 char __b22,
                 char __b21,
                 char __b20,
                 char __b19,
                 char __b18,
                 char __b17,
                 char __b16,
                 char __b15,
                 char __b14,
                 char __b13,
                 char __b12,
                 char __b11,
                 char __b10,
                 char __b09,
                 char __b08,
                 char __b07,
                 char __b06,
                 char __b05,
                 char __b04,
                 char __b03,
                 char __b02,
                 char __b01,
                 char __b00) {
  return _mm256_set_epi8(__b00,
                         __b01,
                         __b02,
                         __b03,
                         __b04,
                         __b05,
                         __b06,
                         __b07,
                         __b08,
                         __b09,
                         __b10,
                         __b11,
                         __b12,
                         __b13,
                         __b14,
                         __b15,
                         __b16,
                         __b17,
                         __b18,
                         __b19,
                         __b20,
                         __b21,
                         __b22,
                         __b23,
                         __b24,
                         __b25,
                         __b26,
                         __b27,
                         __b28,
                         __b29,
                         __b30,
                         __b31);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_setr_epi64x(long long __a, long long __b, long long __c, long long __d) {
  return _mm256_set_epi64x(__d, __c, __b, __a);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_set1_pd(double __w) {
  __m256d_internal ret;
  ret.v1 = ret.v0 = (__m128d)wasm_f64x2_splat(__w);
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_set1_ps(float __w) {
  __m256_internal ret;
  ret.v1 = ret.v0 = (__m128)wasm_f32x4_splat(__w);
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set1_epi32(int __i) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = wasm_i32x4_splat(__i);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set1_epi16(short __w) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = wasm_i16x8_splat(__w);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set1_epi8(char __b) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = wasm_i8x16_splat(__b);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set1_epi64x(long long __q) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = wasm_i64x2_splat(__q);
  return __m256i_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_setzero_pd(void) {
  __m256d_internal ret;
  ret.v1 = ret.v0 = _mm_setzero_pd();
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_setzero_ps(void) {
  __m256_internal ret;
  ret.v1 = ret.v0 = _mm_setzero_ps();
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_setzero_si256(void) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = _mm_setzero_si128();
  return __m256i_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_castpd_ps(__m256d __a) {
  union __m256_data ret;
  ret.double_view = __a;
  return ret.float_view;
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_castpd_si256(__m256d __a) {
  union __m256_data ret;
  ret.double_view = __a;
  return ret.int_view;
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_castps_pd(__m256 __a) {
  union __m256_data ret;
  ret.float_view = __a;
  return ret.double_view;
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_castps_si256(__m256 __a) {
  union __m256_data ret;
  ret.float_view = __a;
  return ret.int_view;
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_castsi256_ps(__m256i __a) {
  union __m256_data ret;
  ret.int_view = __a;
  return ret.float_view;
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_castsi256_pd(__m256i __a) {
  union __m256_data ret;
  ret.int_view = __a;
  return ret.double_view;
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm256_castpd256_pd128(__m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  return a.v0;
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm256_castps256_ps128(__m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  return a.v0;
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm256_castsi256_si128(__m256i __a) {
  __m256i_internal a = __m256i_to_internal(__a);
  return a.v0;
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_castpd128_pd256(__m128d __a) {
  __m256d_internal ret;
  ret.v0 = __a;
  ret.v1 = _mm_setzero_pd();
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_castps128_ps256(__m128 __a) {
  __m256_internal ret;
  ret.v0 = __a;
  ret.v1 = _mm_setzero_ps();
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_castsi128_si256(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = __a;
  ret.v1 = _mm_setzero_si128();
  return __m256i_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_zextpd128_pd256(__m128d __a) {
  __m256d_internal ret;
  ret.v0 = __a;
  ret.v1 = _mm_setzero_pd();
  return __m256d_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_zextps128_ps256(__m128 __a) {
  __m256_internal ret;
  ret.v0 = __a;
  ret.v1 = _mm_setzero_ps();
  return __m256_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_zextsi128_si256(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = __a;
  ret.v1 = _mm_setzero_si128();
  return __m256i_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_insertf128_ps(__m256 __a, __m128 __b, const int imm8) {
  __m256_internal ret = __m256_to_internal(__a);
  if (imm8 & 0x1) {
    ret.v1 = __b;
  } else {
    ret.v0 = __b;
  }
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_insertf128_pd(__m256d __a, __m128d __b, const int imm8) {
  __m256d_internal ret = __m256d_to_internal(__a);
  if (imm8 & 0x1) {
    ret.v1 = __b;
  } else {
    ret.v0 = __b;
  }
  return __m256d_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_insertf128_si256(__m256i __a, __m128i __b, const int imm8) {
  __m256i_internal ret = __m256i_to_internal(__a);
  if (imm8 & 0x1) {
    ret.v1 = __b;
  } else {
    ret.v0 = __b;
  }
  return __m256i_from_internal(ret);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm256_extractf128_ps(__m256 __a, const int imm8) {
  __m256_internal a = __m256_to_internal(__a);
  if (imm8 & 0x1) {
    return a.v1;
  } else {
    return a.v0;
  }
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm256_extractf128_pd(__m256d __a, const int imm8) {
  __m256d_internal a = __m256d_to_internal(__a);
  if (imm8 & 0x1) {
    return a.v1;
  } else {
    return a.v0;
  }
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm256_extractf128_si256(__m256i __a, const int imm8) {
  __m256i_internal a = __m256i_to_internal(__a);
  if (imm8 & 0x1) {
    return a.v1;
  } else {
    return a.v0;
  }
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_set_m128(__m128 __hi, __m128 __lo) {
  __m256_internal ret;
  ret.v0 = __lo;
  ret.v1 = __hi;
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_set_m128d(__m128d __hi, __m128d __lo) {
  __m256d_internal ret;
  ret.v0 = __lo;
  ret.v1 = __hi;
  return __m256d_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_set_m128i(__m128i __hi, __m128i __lo) {
  __m256i_internal ret;
  ret.v0 = __lo;
  ret.v1 = __hi;
  return __m256i_from_internal(ret);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_setr_m128(__m128 __lo, __m128 __hi) {
  return _mm256_set_m128(__hi, __lo);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_setr_m128d(__m128d __lo, __m128d __hi) {
  return (__m256d)_mm256_set_m128d(__hi, __lo);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_setr_m128i(__m128i __lo, __m128i __hi) {
  return (__m256i)_mm256_set_m128i(__hi, __lo);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_loadu2_m128(float const* __addr_hi, float const* __addr_lo) {
  return _mm256_set_m128(_mm_loadu_ps(__addr_hi), _mm_loadu_ps(__addr_lo));
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_loadu2_m128d(double const* __addr_hi, double const* __addr_lo) {
  return _mm256_set_m128d(_mm_loadu_pd(__addr_hi), _mm_loadu_pd(__addr_lo));
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_loadu2_m128i(__m128i_u const* __addr_hi, __m128i_u const* __addr_lo) {
  return _mm256_set_m128i(_mm_loadu_si128((__m128i const*)__addr_hi),
                          _mm_loadu_si128((__m128i const*)__addr_lo));
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_storeu2_m128(float* __addr_hi, float* __addr_lo, __m256 __a) {
  __m256_internal a = __m256_to_internal(__a);
  _mm_storeu_ps(__addr_lo, a.v0);
  _mm_storeu_ps(__addr_hi, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_storeu2_m128d(double* __addr_hi, double* __addr_lo, __m256d __a) {
  __m256d_internal a = __m256d_to_internal(__a);
  _mm_storeu_pd(__addr_lo, a.v0);
  _mm_storeu_pd(__addr_hi, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_storeu2_m128i(__m128i_u* __addr_hi, __m128i_u* __addr_lo, __m256i __a) {
  __m256i_internal a = __m256i_to_internal(__a);
  _mm_storeu_si128((__m128i*)__addr_lo, a.v0);
  _mm_storeu_si128((__m128i*)__addr_hi, a.v1);
}

#endif /* __emscripten_avxintrin_h__ */
`,"avx2intrin.h":`/*
 * Copyright 2024 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

#ifndef __emscripten_immintrin_h__
#error "Never use <avx2intrin.h> directly; include <immintrin.h> instead."
#endif

#ifndef __emscripten_avx2intrin_h__
#define __emscripten_avx2intrin_h__

#ifndef __AVX2__
#error "AVX2 instruction set not enabled"
#endif

#define _mm256_mpsadbw_epu8(__A, __B, __imm)                                   \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                           \\
    __m256i_internal __b = __m256i_to_internal(__B);                           \\
    _mm256_set_m128i(_mm_mpsadbw_epu8(__a.v1, __b.v1, (__imm) >> 3),           \\
                     _mm_mpsadbw_epu8(__a.v0, __b.v0, (__imm)));               \\
  })

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_abs_epi8(__m256i __a) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_abs_epi8(a.v0);
  ret.v1 = _mm_abs_epi8(a.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_abs_epi16(__m256i __a) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_abs_epi16(a.v0);
  ret.v1 = _mm_abs_epi16(a.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_abs_epi32(__m256i __a) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_abs_epi32(a.v0);
  ret.v1 = _mm_abs_epi32(a.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_packs_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_packs_epi16(a.v0, b.v0);
  ret.v1 = _mm_packs_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_packs_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_packs_epi32(a.v0, b.v0);
  ret.v1 = _mm_packs_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_packus_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_packus_epi16(a.v0, b.v0);
  ret.v1 = _mm_packus_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_packus_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_packus_epi32(a.v0, b.v0);
  ret.v1 = _mm_packus_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_add_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_add_epi8(a.v0, b.v0);
  ret.v1 = _mm_add_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_add_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_add_epi16(a.v0, b.v0);
  ret.v1 = _mm_add_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_add_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_add_epi32(a.v0, b.v0);
  ret.v1 = _mm_add_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_add_epi64(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_add_epi64(a.v0, b.v0);
  ret.v1 = _mm_add_epi64(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_adds_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_adds_epi8(a.v0, b.v0);
  ret.v1 = _mm_adds_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_adds_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_adds_epi16(a.v0, b.v0);
  ret.v1 = _mm_adds_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_adds_epu8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_adds_epu8(a.v0, b.v0);
  ret.v1 = _mm_adds_epu8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_adds_epu16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_adds_epu16(a.v0, b.v0);
  ret.v1 = _mm_adds_epu16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

#define _mm256_alignr_epi8(__A, __B, __imm)                                    \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    __m256i_internal __b = __m256i_to_internal(__B);                             \\
    _mm256_set_m128i(_mm_alignr_epi8(__a.v1, __b.v1, (__imm)),                 \\
                     _mm_alignr_epi8(__a.v0, __b.v0, (__imm)));                \\
  })

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_and_si256(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_and_si128(a.v0, b.v0);
  ret.v1 = _mm_and_si128(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_andnot_si256(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_andnot_si128(a.v0, b.v0);
  ret.v1 = _mm_andnot_si128(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_avg_epu8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_avg_epu8(a.v0, b.v0);
  ret.v1 = _mm_avg_epu8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_avg_epu16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_avg_epu16(a.v0, b.v0);
  ret.v1 = _mm_avg_epu16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_blendv_epi8(__m256i __a, __m256i __b, __m256i __mask) {
  __m256i_internal ret, a, b, mask;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  mask = __m256i_to_internal(__mask);
  ret.v0 = _mm_blendv_epi8(a.v0, b.v0, mask.v0);
  ret.v1 = _mm_blendv_epi8(a.v1, b.v1, mask.v1);
  return __m256i_from_internal(ret);
}

#define _mm256_blend_epi16(__A, __B, __imm)                                    \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    __m256i_internal __b = __m256i_to_internal(__B);                             \\
    _mm256_set_m128i(_mm_blend_epi16(__a.v1, __b.v1, (__imm)),                 \\
                     _mm_blend_epi16(__a.v0, __b.v0, (__imm)));                \\
  })

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpeq_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpeq_epi8(a.v0, b.v0);
  ret.v1 = _mm_cmpeq_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpeq_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpeq_epi16(a.v0, b.v0);
  ret.v1 = _mm_cmpeq_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpeq_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpeq_epi32(a.v0, b.v0);
  ret.v1 = _mm_cmpeq_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpeq_epi64(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpeq_epi64(a.v0, b.v0);
  ret.v1 = _mm_cmpeq_epi64(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpgt_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpgt_epi8(a.v0, b.v0);
  ret.v1 = _mm_cmpgt_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpgt_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpgt_epi16(a.v0, b.v0);
  ret.v1 = _mm_cmpgt_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpgt_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpgt_epi32(a.v0, b.v0);
  ret.v1 = _mm_cmpgt_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cmpgt_epi64(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_cmpgt_epi64(a.v0, b.v0);
  ret.v1 = _mm_cmpgt_epi64(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_hadd_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_hadd_epi16(a.v0, b.v0);
  ret.v1 = _mm_hadd_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_hadd_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_hadd_epi32(a.v0, b.v0);
  ret.v1 = _mm_hadd_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_hadds_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_hadds_epi16(a.v0, b.v0);
  ret.v1 = _mm_hadds_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_hsub_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_hsub_epi16(a.v0, b.v0);
  ret.v1 = _mm_hsub_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_hsub_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_hsub_epi32(a.v0, b.v0);
  ret.v1 = _mm_hsub_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_hsubs_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_hsubs_epi16(a.v0, b.v0);
  ret.v1 = _mm_hsubs_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_maddubs_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_maddubs_epi16(a.v0, b.v0);
  ret.v1 = _mm_maddubs_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_madd_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_madd_epi16(a.v0, b.v0);
  ret.v1 = _mm_madd_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_max_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_max_epi8(a.v0, b.v0);
  ret.v1 = _mm_max_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_max_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_max_epi16(a.v0, b.v0);
  ret.v1 = _mm_max_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_max_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_max_epi32(a.v0, b.v0);
  ret.v1 = _mm_max_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_max_epu8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_max_epu8(a.v0, b.v0);
  ret.v1 = _mm_max_epu8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_max_epu16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_max_epu16(a.v0, b.v0);
  ret.v1 = _mm_max_epu16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_max_epu32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_max_epu32(a.v0, b.v0);
  ret.v1 = _mm_max_epu32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_min_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_min_epi8(a.v0, b.v0);
  ret.v1 = _mm_min_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_min_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_min_epi16(a.v0, b.v0);
  ret.v1 = _mm_min_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_min_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_min_epi32(a.v0, b.v0);
  ret.v1 = _mm_min_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_min_epu8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_min_epu8(a.v0, b.v0);
  ret.v1 = _mm_min_epu8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_min_epu16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_min_epu16(a.v0, b.v0);
  ret.v1 = _mm_min_epu16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_min_epu32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_min_epu32(a.v0, b.v0);
  ret.v1 = _mm_min_epu32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ int __attribute__((__always_inline__, __nodebug__))
_mm256_movemask_epi8(__m256i __a) {
  __m256i_internal a = __m256i_to_internal(__a);
  return (_mm_movemask_epi8(a.v1) << 16) | _mm_movemask_epi8(a.v0);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi8_epi16(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepi8_epi16(__a);
  ret.v1 = _mm_cvtepi8_epi16(_mm_shuffle_epi32(__a, 0x4E));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi8_epi32(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepi8_epi32(__a);
  ret.v1 = _mm_cvtepi8_epi32(_mm_shuffle_epi32(__a, 0xE1));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi8_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepi8_epi64(__a);
  ret.v1 = _mm_cvtepi8_epi64(_mm_srli_epi32(__a, 16));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi16_epi32(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepi16_epi32(__a);
  ret.v1 = _mm_cvtepi16_epi32(_mm_shuffle_epi32(__a, 0x4E));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi16_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepi16_epi64(__a);
  ret.v1 = _mm_cvtepi16_epi64(_mm_shuffle_epi32(__a, 0xE1));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepi32_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepi32_epi64(__a);
  ret.v1 = _mm_cvtepi32_epi64(_mm_shuffle_epi32(__a, 0x4E));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepu8_epi16(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepu8_epi16(__a);
  ret.v1 = _mm_cvtepu8_epi16(_mm_shuffle_epi32(__a, 0x4E));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepu8_epi32(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepu8_epi32(__a);
  ret.v1 = _mm_cvtepu8_epi32(_mm_shuffle_epi32(__a, 0xE1));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepu8_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepu8_epi64(__a);
  ret.v1 = _mm_cvtepu8_epi64(_mm_srli_epi32(__a, 16));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepu16_epi32(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepu16_epi32(__a);
  ret.v1 = _mm_cvtepu16_epi32(_mm_shuffle_epi32(__a, 0x4E));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepu16_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepu16_epi64(__a);
  ret.v1 = _mm_cvtepu16_epi64(_mm_shuffle_epi32(__a, 0xE1));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_cvtepu32_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v0 = _mm_cvtepu32_epi64(__a);
  ret.v1 = _mm_cvtepu32_epi64(_mm_shuffle_epi32(__a, 0x4E));
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mul_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mul_epi32(a.v0, b.v0);
  ret.v1 = _mm_mul_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mulhrs_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mulhrs_epi16(a.v0, b.v0);
  ret.v1 = _mm_mulhrs_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mulhi_epu16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mulhi_epu16(a.v0, b.v0);
  ret.v1 = _mm_mulhi_epu16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mulhi_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mulhi_epi16(a.v0, b.v0);
  ret.v1 = _mm_mulhi_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mullo_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mullo_epi16(a.v0, b.v0);
  ret.v1 = _mm_mullo_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mullo_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mullo_epi32(a.v0, b.v0);
  ret.v1 = _mm_mullo_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_mul_epu32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_mul_epu32(a.v0, b.v0);
  ret.v1 = _mm_mul_epu32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_or_si256(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_or_si128(a.v0, b.v0);
  ret.v1 = _mm_or_si128(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sad_epu8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sad_epu8(a.v0, b.v0);
  ret.v1 = _mm_sad_epu8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_shuffle_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_shuffle_epi8(a.v0, b.v0);
  ret.v1 = _mm_shuffle_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

#define _mm256_shuffle_epi32(__A, __imm)                                       \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    _mm256_set_m128i(_mm_shuffle_epi32(__a.v1, (__imm)),                       \\
                     _mm_shuffle_epi32(__a.v0, (__imm)));                      \\
  })

#define _mm256_shufflehi_epi16(__A, __imm)                                     \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    _mm256_set_m128i(_mm_shufflehi_epi16(__a.v1, (__imm)),                     \\
                     _mm_shufflehi_epi16(__a.v0, (__imm)));                    \\
  })

#define _mm256_shufflelo_epi16(__A, __imm)                                     \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    _mm256_set_m128i(_mm_shufflelo_epi16(__a.v1, (__imm)),                     \\
                     _mm_shufflelo_epi16(__a.v0, (__imm)));                    \\
  })

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sign_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sign_epi8(a.v0, b.v0);
  ret.v1 = _mm_sign_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sign_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sign_epi16(a.v0, b.v0);
  ret.v1 = _mm_sign_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sign_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sign_epi32(a.v0, b.v0);
  ret.v1 = _mm_sign_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

#define _mm256_slli_si256(__A, __imm)                                          \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    _mm256_set_m128i(_mm_slli_si128(__a.v1, (__imm)),                          \\
                     _mm_slli_si128(__a.v0, (__imm)));                         \\
  })

#define _mm256_bslli_epi128(__A, __imm) _mm256_slli_si256(__A, __imm)

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_slli_epi16(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_slli_epi16(a.v0, __count);
  ret.v1 = _mm_slli_epi16(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sll_epi16(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_sll_epi16(a.v0, __count);
  ret.v1 = _mm_sll_epi16(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_slli_epi32(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_slli_epi32(a.v0, __count);
  ret.v1 = _mm_slli_epi32(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sll_epi32(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_sll_epi32(a.v0, __count);
  ret.v1 = _mm_sll_epi32(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_slli_epi64(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_slli_epi64(a.v0, __count);
  ret.v1 = _mm_slli_epi64(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sll_epi64(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_sll_epi64(a.v0, __count);
  ret.v1 = _mm_sll_epi64(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srai_epi16(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srai_epi16(a.v0, __count);
  ret.v1 = _mm_srai_epi16(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sra_epi16(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_sra_epi16(a.v0, __count);
  ret.v1 = _mm_sra_epi16(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srai_epi32(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srai_epi32(a.v0, __count);
  ret.v1 = _mm_srai_epi32(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sra_epi32(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_sra_epi32(a.v0, __count);
  ret.v1 = _mm_sra_epi32(a.v1, __count);
  return __m256i_from_internal(ret);
}

#define _mm256_srli_si256(__A, __imm)                                          \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    _mm256_set_m128i(_mm_srli_si128(__a.v1, (__imm)),                          \\
                     _mm_srli_si128(__a.v0, (__imm)));                         \\
  })

#define _mm256_bsrli_epi128(a, imm) _mm256_srli_si256(a, imm)

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srli_epi16(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srli_epi16(a.v0, __count);
  ret.v1 = _mm_srli_epi16(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srl_epi16(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srl_epi16(a.v0, __count);
  ret.v1 = _mm_srl_epi16(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srli_epi32(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srli_epi32(a.v0, __count);
  ret.v1 = _mm_srli_epi32(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srl_epi32(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srl_epi32(a.v0, __count);
  ret.v1 = _mm_srl_epi32(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srli_epi64(__m256i __a, int __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srli_epi64(a.v0, __count);
  ret.v1 = _mm_srli_epi64(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_srl_epi64(__m256i __a, __m128i __count) {
  __m256i_internal ret, a;
  a = __m256i_to_internal(__a);
  ret.v0 = _mm_srl_epi64(a.v0, __count);
  ret.v1 = _mm_srl_epi64(a.v1, __count);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sub_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sub_epi8(a.v0, b.v0);
  ret.v1 = _mm_sub_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sub_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sub_epi16(a.v0, b.v0);
  ret.v1 = _mm_sub_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sub_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sub_epi32(a.v0, b.v0);
  ret.v1 = _mm_sub_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_sub_epi64(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_sub_epi64(a.v0, b.v0);
  ret.v1 = _mm_sub_epi64(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_subs_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_subs_epi8(a.v0, b.v0);
  ret.v1 = _mm_subs_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_subs_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_subs_epi16(a.v0, b.v0);
  ret.v1 = _mm_subs_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_subs_epu8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_subs_epu8(a.v0, b.v0);
  ret.v1 = _mm_subs_epu8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_subs_epu16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_subs_epu16(a.v0, b.v0);
  ret.v1 = _mm_subs_epu16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpackhi_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpackhi_epi8(a.v0, b.v0);
  ret.v1 = _mm_unpackhi_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpackhi_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpackhi_epi16(a.v0, b.v0);
  ret.v1 = _mm_unpackhi_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpackhi_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpackhi_epi32(a.v0, b.v0);
  ret.v1 = _mm_unpackhi_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpackhi_epi64(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpackhi_epi64(a.v0, b.v0);
  ret.v1 = _mm_unpackhi_epi64(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpacklo_epi8(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpacklo_epi8(a.v0, b.v0);
  ret.v1 = _mm_unpacklo_epi8(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpacklo_epi16(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpacklo_epi16(a.v0, b.v0);
  ret.v1 = _mm_unpacklo_epi16(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpacklo_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpacklo_epi32(a.v0, b.v0);
  ret.v1 = _mm_unpacklo_epi32(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_unpacklo_epi64(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_unpacklo_epi64(a.v0, b.v0);
  ret.v1 = _mm_unpacklo_epi64(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_xor_si256(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  ret.v0 = _mm_xor_si128(a.v0, b.v0);
  ret.v1 = _mm_xor_si128(a.v1, b.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_stream_load_si256(const void* __V) {
  __m256i_internal ret;
  ret.v0 = _mm_stream_load_si128((const __m128i*)__V);
  ret.v1 = _mm_stream_load_si128((const __m128i*)(((const uint8_t*)__V) + 16));
  return __m256i_from_internal(ret);
}

static __inline__ __m128 __attribute__((__always_inline__, __nodebug__))
_mm_broadcastss_ps(__m128 __a) {
  return (__m128)wasm_i32x4_shuffle(__a, __a, 0, 0, 0, 0);
}

static __inline__ __m128d __attribute__((__always_inline__, __nodebug__))
_mm_broadcastsd_pd(__m128d __a) {
  return (__m128d)wasm_i64x2_shuffle(__a, __a, 0, 0);
}

static __inline__ __m256 __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastss_ps(__m128 __a) {
  __m256_internal ret;
  ret.v1 = ret.v0 = _mm_broadcastss_ps(__a);
  return __m256_from_internal(ret);
}

static __inline__ __m256d __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastsd_pd(__m128d __a) {
  __m256d_internal ret;
  ret.v1 = ret.v0 = _mm_broadcastsd_pd(__a);
  return __m256d_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastsi128_si256(__m128i __a) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = __a;
  return __m256i_from_internal(ret);
}

#define _mm_broadcastsi128_si256(X) _mm256_broadcastsi128_si256(X)

#define _mm_blend_epi32(__a, __b, __imm8)                                      \\
  __extension__({                                                              \\
    (__m128i) __builtin_shufflevector((__i32x4)(__m128i)(__a),                 \\
                                      (__i32x4)(__m128i)(__b),                 \\
                                      (((__imm8) & 0x01) ? 4 : 0),             \\
                                      (((__imm8) & 0x02) ? 5 : 1),             \\
                                      (((__imm8) & 0x04) ? 6 : 2),             \\
                                      (((__imm8) & 0x08) ? 7 : 3));            \\
  })

#define _mm256_blend_epi32(__A, __B, __imm)                                    \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    __m256i_internal __b = __m256i_to_internal(__B);                             \\
    _mm256_set_m128i(_mm_blend_epi32(__a.v1, __b.v1, (__imm) >> 4),            \\
                     _mm_blend_epi32(__a.v0, __b.v0, (__imm)));                \\
  })

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_broadcastb_epi8(__m128i __a) {
  return (__m128i)wasm_i8x16_shuffle(
    __a, __a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_broadcastw_epi16(__m128i __a) {
  return (__m128i)wasm_i16x8_shuffle(__a, __a, 0, 0, 0, 0, 0, 0, 0, 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_broadcastd_epi32(__m128i __a) {
  return (__m128i)wasm_i32x4_shuffle(__a, __a, 0, 0, 0, 0);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_broadcastq_epi64(__m128i __a) {
  return (__m128i)wasm_i64x2_shuffle(__a, __a, 0, 0);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastb_epi8(__m128i __a) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = _mm_broadcastb_epi8(__a);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastw_epi16(__m128i __a) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = _mm_broadcastw_epi16(__a);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastd_epi32(__m128i __a) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = _mm_broadcastd_epi32(__a);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_broadcastq_epi64(__m128i __a) {
  __m256i_internal ret;
  ret.v1 = ret.v0 = _mm_broadcastq_epi64(__a);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_permutevar8x32_epi32(__m256i __a, __m256i __b) {
  __m256i_internal ret, a, b;
  a = __m256i_to_internal(__a);
  b = __m256i_to_internal(__b);
  int index[8];
  int lane[8];
  for (int i = 0; i < 4; i++) {
    index[i] = ((__i32x4)b.v0)[i] & 7;
    index[i + 4] = ((__i32x4)b.v1)[i] & 7;
  }

  for (int j = 0; j < 8; j++) {
    lane[j] = index[j] < 4 ? ((__i32x4)(a.v0))[index[j]]
                           : ((__i32x4)(a.v1))[index[j] - 4];
  }

  ret.v0 = (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
  ret.v1 = (__m128i)wasm_i32x4_make(lane[4], lane[5], lane[6], lane[7]);
  return __m256i_from_internal(ret);
}

#define _mm256_permute4x64_pd(__A, __imm)                                      \\
  __extension__({                                                              \\
    __m256d_internal __a = __m256d_to_internal(__A);                             \\
    _mm256_set_m128d(                                                          \\
      (__m128d)wasm_i64x2_shuffle(                                             \\
        __a.v0, __a.v1, (((__imm) >> 4) & 3), (((__imm) >> 6) & 3)),           \\
      (__m128d)wasm_i64x2_shuffle(                                             \\
        __a.v0, __a.v1, ((__imm) & 3), (((__imm) >> 2) & 3)));                 \\
  })

static __inline__ __m256
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_permutevar8x32_ps(__m256 __a, __m256i __b) {
  __m256_internal ret;
  __m256_internal a = __m256_to_internal(__a);
  __m256i_internal b = __m256i_to_internal(__b);
  int index[8];
  float lane[8];
  for (int i = 0; i < 4; i++) {
    index[i] = ((__i32x4)b.v0)[i] & 7;
    index[i + 4] = ((__i32x4)b.v1)[i] & 7;
  }
  for (int j = 0; j < 8; j++) {
    lane[j] = index[j] < 4 ? ((__f32x4)(a.v0))[index[j]]
                           : ((__f32x4)(a.v1))[index[j] - 4];
  }
  ret.v0 = (__m128)wasm_f32x4_make(lane[0], lane[1], lane[2], lane[3]);
  ret.v1 = (__m128)wasm_f32x4_make(lane[4], lane[5], lane[6], lane[7]);
  return __m256_from_internal(ret);
}

#define _mm256_permute4x64_epi64(__A, __imm)                                   \\
  __extension__({                                                              \\
    __m256i_internal __a = __m256i_to_internal(__A);                             \\
    _mm256_set_m128i(                                                          \\
      wasm_i64x2_shuffle(                                                      \\
        __a.v0, __a.v1, (((__imm) >> 4) & 3), (((__imm) >> 6) & 3)),           \\
      wasm_i64x2_shuffle(                                                      \\
        __a.v0, __a.v1, ((__imm) & 3), (((__imm) >> 2) & 3)));                 \\
  })

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_permute2x128_si256(__m256i __a, __m256i __b, const int imm8) {
  __m256i_internal ret;
  ret.v0 = __avx_select4i(__a, __b, imm8);
  ret.v1 = __avx_select4i(__a, __b, imm8 >> 4);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm256_extracti128_si256(__m256i __a, const int imm8) {
  __m256i_internal a = __m256i_to_internal(__a);
  if (imm8 & 0x1) {
    return a.v1;
  } else {
    return a.v0;
  }
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_inserti128_si256(__m256i __a, __m128i __b, const int imm8) {
  __m256i_internal ret = __m256i_to_internal(__a);
  if (imm8 & 0x1) {
    ret.v1 = __b;
  } else {
    ret.v0 = __b;
  }
  return __m256i_from_internal(ret);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_maskload_epi32(int32_t const* __p, __m128i __m) {
  int32_t lane[4];
  for (size_t i = 0; i < 4; i++) {
    uint32_t mask = ((__i32x4)__m)[i];
    lane[i] = ((mask >> 31) & 0x1) ? __p[i] : 0;
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m128i __attribute__((__always_inline__, __nodebug__))
_mm_maskload_epi64(int64_t const* __p, __m128i __m) {
  int64_t lane[2];
  for (size_t i = 0; i < 2; i++) {
    uint64_t mask = ((__i64x2)__m)[i];
    lane[i] = ((mask >> 63) & 0x1) ? __p[i] : 0;
  }
  return (__m128i)wasm_i64x2_make(lane[0], lane[1]);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_maskload_epi32(int const* __p, __m256i __m) {
  __m256i_internal ret, m;
  m = __m256i_to_internal(__m);
  ret.v0 = _mm_maskload_epi32(__p, m.v0);
  ret.v1 = _mm_maskload_epi32(((int32_t*)__p) + 4, m.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m256i __attribute__((__always_inline__, __nodebug__))
_mm256_maskload_epi64(long long const* __p, __m256i __m) {
  __m256i_internal ret, m;
  m = __m256i_to_internal(__m);
  ret.v0 = _mm_maskload_epi64(__p, m.v0);
  ret.v1 = _mm_maskload_epi64(((int64_t*)__p) + 2, m.v1);
  return __m256i_from_internal(ret);
}

static __inline__ void
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_maskstore_epi32(int* __p, __m128i __m, __m128i __a) {
  if ((wasm_i32x4_extract_lane(__m, 0) & 0x80000000ull) != 0)
    __p[0] = wasm_i32x4_extract_lane((v128_t)__a, 0);
  if ((wasm_i32x4_extract_lane(__m, 1) & 0x80000000ull) != 0)
    __p[1] = wasm_i32x4_extract_lane((v128_t)__a, 1);
  if ((wasm_i32x4_extract_lane(__m, 2) & 0x80000000ull) != 0)
    __p[2] = wasm_i32x4_extract_lane((v128_t)__a, 2);
  if ((wasm_i32x4_extract_lane(__m, 3) & 0x80000000ull) != 0)
    __p[3] = wasm_i32x4_extract_lane((v128_t)__a, 3);
}

static __inline__ void
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_maskstore_epi64(long long* __p, __m128i __m, __m128i __a) {
  if ((wasm_i64x2_extract_lane(__m, 0) & 0x8000000000000000ull) != 0)
    __p[0] = wasm_i64x2_extract_lane((v128_t)__a, 0);
  if ((wasm_i64x2_extract_lane(__m, 1) & 0x8000000000000000ull) != 0)
    __p[1] = wasm_i64x2_extract_lane((v128_t)__a, 1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_maskstore_epi32(int* __p, __m256i __m, __m256i __a) {
  __m256i_internal m, a;
  m = __m256i_to_internal(__m);
  a = __m256i_to_internal(__a);
  _mm_maskstore_epi32(__p, m.v0, a.v0);
  _mm_maskstore_epi32(((int32_t*)__p) + 4, m.v1, a.v1);
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm256_maskstore_epi64(long long* __p, __m256i __m, __m256i __a) {
  __m256i_internal m, a;
  m = __m256i_to_internal(__m);
  a = __m256i_to_internal(__a);
  _mm_maskstore_epi64(__p, m.v0, a.v0);
  _mm_maskstore_epi64(((int64_t*)__p) + 2, m.v1, a.v1);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_sllv_epi32(__m128i __a, __m128i __count) {
  int32_t lane[4];
  for (size_t i = 0; i < 4; i++) {
    uint32_t shift = ((__u32x4)__count)[i];
    lane[i] = shift < 32 ? ((__u32x4)__a)[i] << shift : 0;
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_sllv_epi32(__m256i __a, __m256i __count) {
  __m256i_internal ret, a, count;
  a = __m256i_to_internal(__a);
  count = __m256i_to_internal(__count);
  ret.v0 = _mm_sllv_epi32(a.v0, count.v0);
  ret.v1 = _mm_sllv_epi32(a.v1, count.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_sllv_epi64(__m128i __a, __m128i __count) {

  int64_t lane[2];
  for (size_t i = 0; i < 2; i++) {
    uint64_t shift = (uint64_t)((__u64x2)__count)[i];
    lane[i] = shift < 64 ? ((__u64x2)__a)[i] << shift : 0;
  }
  return (__m128i)wasm_i64x2_make(lane[0], lane[1]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_sllv_epi64(__m256i __a, __m256i __count) {
  __m256i_internal ret, a, count;
  a = __m256i_to_internal(__a);
  count = __m256i_to_internal(__count);
  ret.v0 = _mm_sllv_epi64(a.v0, count.v0);
  ret.v1 = _mm_sllv_epi64(a.v1, count.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_srav_epi32(__m128i __a, __m128i __count) {
  int32_t lane[4];
  for (size_t i = 0; i < 4; i++) {
    uint32_t shift = ((__u32x4)__count)[i];
    shift = shift < 31 ? shift : 31;
    lane[i] = ((__i32x4)__a)[i] >> shift;
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_srav_epi32(__m256i __a, __m256i __count) {
  __m256i_internal ret, a, count;
  a = __m256i_to_internal(__a);
  count = __m256i_to_internal(__count);
  ret.v0 = _mm_srav_epi32(a.v0, count.v0);
  ret.v1 = _mm_srav_epi32(a.v1, count.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_srlv_epi32(__m128i __a, __m128i __count) {
  int32_t lane[4];
  for (size_t i = 0; i < 4; i++) {
    uint32_t shift = ((__u32x4)__count)[i];
    lane[i] = shift < 32 ? ((__u32x4)__a)[i] >> shift : 0;
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_srlv_epi32(__m256i __a, __m256i __count) {
  __m256i_internal ret, a, count;
  a = __m256i_to_internal(__a);
  count = __m256i_to_internal(__count);
  ret.v0 = _mm_srlv_epi32(a.v0, count.v0);
  ret.v1 = _mm_srlv_epi32(a.v1, count.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_srlv_epi64(__m128i __a, __m128i __count) {
  int64_t lane[2];
  for (size_t i = 0; i < 2; i++) {
    uint64_t shift = ((__u64x2)__count)[i];
    lane[i] = shift < 64 ? ((__u64x2)__a)[i] >> shift : 0;
  }
  return (__m128i)wasm_i64x2_make(lane[0], lane[1]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_srlv_epi64(__m256i __a, __m256i __count) {
  __m256i_internal ret, a, count;
  a = __m256i_to_internal(__a);
  count = __m256i_to_internal(__count);
  ret.v0 = _mm_srlv_epi64(a.v0, count.v0);
  ret.v1 = _mm_srlv_epi64(a.v1, count.v1);
  return __m256i_from_internal(ret);
}

static __inline__ __m128d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i32gather_pd(__m128d src,
                        const double* base_addr,
                        __m128i vindex,
                        __m128d mask,
                        const int scale) {
  double lane[2];
  for (size_t i = 0; i < 2; i++) {
    if ((((__i64x2)mask)[i] >> 63) & 0x1) {
      double* addr =
        (double*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                          (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__f64x2)src)[i];
    }
  }
  return (__m128d)wasm_f64x2_make(lane[0], lane[1]);
}

static __inline__ __m256d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i32gather_pd(__m256d __src,
                           const double* base_addr,
                           __m128i vindex,
                           __m256d __mask,
                           const int scale) {
  __m256d_internal ret, src, mask;
  src = __m256d_to_internal(__src);
  mask = __m256d_to_internal(__mask);
  ret.v0 = _mm_mask_i32gather_pd(src.v0, base_addr, vindex, mask.v0, scale);
  __m128i vindex1 = (__m128i)wasm_i32x4_shuffle(vindex, vindex, 2, 3, 0, 1);
  ret.v1 = _mm_mask_i32gather_pd(src.v1, base_addr, vindex1, mask.v1, scale);
  return __m256d_from_internal(ret);
}

static __inline__ __m128d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i64gather_pd(__m128d src,
                        const double* base_addr,
                        __m128i vindex,
                        __m128d mask,
                        const int scale) {
  double lane[2];
  for (size_t i = 0; i < 2; i++) {
    if ((((__i64x2)mask)[i] >> 63) & 0x1) {
      double* addr =
        (double*)((uint8_t*)base_addr +
                  ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__f64x2)src)[i];
    }
  }
  return (__m128d)wasm_f64x2_make(lane[0], lane[1]);
}

static __inline__ __m256d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i64gather_pd(__m256d __src,
                           const double* base_addr,
                           __m256i __vindex,
                           __m256d __mask,
                           const int scale) {
  __m256d_internal ret, src, mask;
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  src = __m256d_to_internal(__src);
  mask = __m256d_to_internal(__mask);
  ret.v0 = _mm_mask_i64gather_pd(src.v0, base_addr, vindex.v0, mask.v0, scale);
  ret.v1 = _mm_mask_i64gather_pd(src.v1, base_addr, vindex.v1, mask.v1, scale);
  return __m256d_from_internal(ret);
}

static __inline__ __m128
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i32gather_ps(__m128 src,
                        const float* base_addr,
                        __m128i vindex,
                        __m128 mask,
                        const int scale) {
  float lane[4];
  for (size_t i = 0; i < 4; i++) {
    if ((((__i32x4)mask)[i] >> 31) & 0x1) {
      float* addr =
        (float*)((uint8_t*)base_addr +
                 (int64_t)(((__i32x4)vindex)[i]) * (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__f32x4)src)[i];
    }
  }
  return (__m128)wasm_f32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m256
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i32gather_ps(__m256 __src,
                           const float* base_addr,
                           __m256i __vindex,
                           __m256 __mask,
                           const int scale) {
  __m256_internal ret, src, mask;
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  src = __m256_to_internal(__src);
  mask = __m256_to_internal(__mask);
  ret.v0 = _mm_mask_i32gather_ps(src.v0, base_addr, vindex.v0, mask.v0, scale);
  ret.v1 = _mm_mask_i32gather_ps(src.v1, base_addr, vindex.v1, mask.v1, scale);
  return __m256_from_internal(ret);
}

static __inline__ __m128
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i64gather_ps(__m128 src,
                        const float* base_addr,
                        __m128i vindex,
                        __m128 mask,
                        const int scale) {
  float lane[2];
  for (size_t i = 0; i < 2; i++) {
    if ((((__i32x4)mask)[i] >> 31) & 0x1) {
      float* addr =
        (float*)((uint8_t*)base_addr +
                 ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__f32x4)src)[i];
    }
  }
  return (__m128)wasm_f32x4_make(lane[0], lane[1], 0, 0);
}

static __inline__ __m128
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i64gather_ps(__m128 src,
                           const float* base_addr,
                           __m256i __vindex,
                           __m128 mask,
                           const int scale) {
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  float lane[4];
  __m128i current_vindex;
  for (size_t i = 0; i < 4; i++) {
    current_vindex = i < 2 ? vindex.v0 : vindex.v1;
    if ((((__i32x4)mask)[i] >> 31) & 0x1) {
      float* addr =
        (float*)((uint8_t*)base_addr + ((__i64x2)current_vindex)[i & 1] *
                                         (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__f32x4)src)[i];
    }
  }
  return (__m128)wasm_f32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i32gather_epi32(__m128i src,
                           const int* base_addr,
                           __m128i vindex,
                           __m128i mask,
                           const int scale) {
  int32_t lane[4];
  for (size_t i = 0; i < 4; i++) {
    if ((((__i32x4)mask)[i] >> 31) & 0x1) {
      int32_t* addr =
        (int32_t*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                           (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__i32x4)src)[i];
    }
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i32gather_epi32(__m256i __src,
                              const int* base_addr,
                              __m256i __vindex,
                              __m256i __mask,
                              const int scale) {
  __m256i_internal ret, src, vindex, mask;
  src = __m256i_to_internal(__src);
  vindex = __m256i_to_internal(__vindex);
  mask = __m256i_to_internal(__mask);
  ret.v0 =
    _mm_mask_i32gather_epi32(src.v0, base_addr, vindex.v0, mask.v0, scale);
  ret.v1 =
    _mm_mask_i32gather_epi32(src.v1, base_addr, vindex.v1, mask.v1, scale);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i64gather_epi32(__m128i src,
                           const int* base_addr,
                           __m128i vindex,
                           __m128i mask,
                           const int scale) {
  int32_t lane[2];
  for (size_t i = 0; i < 2; i++) {
    if ((((__i32x4)mask)[i] >> 31) & 0x1) {
      int32_t* addr =
        (int32_t*)((uint8_t*)base_addr +
                   ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__i32x4)src)[i];
    }
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], 0, 0);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i64gather_epi32(__m128i src,
                              const int* base_addr,
                              __m256i __vindex,
                              __m128i mask,
                              const int scale) {
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  int32_t lane[4];
  __m128i current_vindex;
  for (size_t i = 0; i < 4; i++) {
    current_vindex = i < 2 ? vindex.v0 : vindex.v1;
    if ((((__i32x4)mask)[i] >> 31) & 0x1) {
      int32_t* addr =
        (int32_t*)((uint8_t*)base_addr + ((__i64x2)current_vindex)[i & 1] *
                                           (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__i32x4)src)[i];
    }
  }
  return (__m128i)wasm_i32x4_make(lane[0], lane[1], lane[2], lane[3]);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i32gather_epi64(__m128i src,
                           const long long* base_addr,
                           __m128i vindex,
                           __m128i mask,
                           const int scale) {
  int64_t lane[2];
  for (size_t i = 0; i < 2; i++) {
    if ((((__i64x2)mask)[i] >> 63) & 0x1) {
      int64_t* addr =
        (int64_t*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                           (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__i64x2)src)[i];
    }
  }
  return (__m128i)wasm_i64x2_make(lane[0], lane[1]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i32gather_epi64(__m256i __src,
                              const long long* base_addr,
                              __m128i vindex,
                              __m256i __mask,
                              const int scale) {
  __m256i_internal ret, src, mask;
  src = __m256i_to_internal(__src);
  mask = __m256i_to_internal(__mask);
  ret.v0 = _mm_mask_i32gather_epi64(src.v0, base_addr, vindex, mask.v0, scale);
  __m128i vindex1 = (__m128i)wasm_i32x4_shuffle(vindex, vindex, 2, 3, 0, 1);
  ret.v1 = _mm_mask_i32gather_epi64(src.v1, base_addr, vindex1, mask.v1, scale);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_mask_i64gather_epi64(__m128i src,
                           const long long* base_addr,
                           __m128i vindex,
                           __m128i mask,
                           const int scale) {
  int64_t lane[2];
  for (size_t i = 0; i < 2; i++) {
    if ((((__i64x2)mask)[i] >> 63) & 0x1) {
      int64_t* addr =
        (int64_t*)((uint8_t*)base_addr +
                   ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
      lane[i] = *addr;
    } else {
      lane[i] = ((__i64x2)src)[i];
    }
  }
  return (__m128i)wasm_i64x2_make(lane[0], lane[1]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_mask_i64gather_epi64(__m256i __src,
                              const long long* base_addr,
                              __m256i __vindex,
                              __m256i __mask,
                              const int scale) {
  __m256i_internal ret, src, vindex, mask;
  src = __m256i_to_internal(__src);
  vindex = __m256i_to_internal(__vindex);
  mask = __m256i_to_internal(__mask);
  ret.v0 =
    _mm_mask_i64gather_epi64(src.v0, base_addr, vindex.v0, mask.v0, scale);
  ret.v1 =
    _mm_mask_i64gather_epi64(src.v1, base_addr, vindex.v1, mask.v1, scale);
  return __m256i_from_internal(ret);
}

static __inline__ __m128d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i32gather_pd(const double* base_addr, __m128i vindex, const int scale) {
  double* lane[2];
  for (size_t i = 0; i < 2; i++) {
    lane[i] = (double*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                                (uint64_t)((uint32_t)scale));
  }
  return (__m128d)wasm_f64x2_make(*lane[0], *lane[1]);
}

static __inline__ __m256d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i32gather_pd(const double* base_addr,
                      __m128i vindex,
                      const int scale) {
  __m256d_internal ret;
  double* lane[4];
  for (size_t i = 0; i < 4; i++) {
    lane[i] = (double*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                                (uint64_t)((uint32_t)scale));
  }
  ret.v0 = (__m128d)wasm_f64x2_make(*lane[0], *lane[1]);
  ret.v1 = (__m128d)wasm_f64x2_make(*lane[2], *lane[3]);
  return __m256d_from_internal(ret);
}

static __inline__ __m128d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i64gather_pd(const double* base_addr, __m128i vindex, const int scale) {
  double* lane[2];
  for (size_t i = 0; i < 2; i++) {
    lane[i] = (double*)((uint8_t*)base_addr +
                        ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
  }
  return (__m128d)wasm_f64x2_make(*lane[0], *lane[1]);
}

static __inline__ __m256d
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i64gather_pd(const double* base_addr,
                      __m256i __vindex,
                      const int scale) {
  __m256d_internal ret;
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  ret.v0 = _mm_i64gather_pd(base_addr, vindex.v0, scale);
  ret.v1 = _mm_i64gather_pd(base_addr, vindex.v1, scale);
  return __m256d_from_internal(ret);
}

static __inline__ __m128
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i32gather_ps(const float* base_addr, __m128i vindex, const int scale) {
  float* lane[4];
  for (size_t i = 0; i < 4; i++) {
    lane[i] = (float*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                               (uint64_t)((uint32_t)scale));
  }
  return (__m128)wasm_f32x4_make(*lane[0], *lane[1], *lane[2], *lane[3]);
}

static __inline__ __m256
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i32gather_ps(const float* base_addr, __m256i __vindex, const int scale) {
  __m256_internal ret;
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  ret.v0 = _mm_i32gather_ps(base_addr, vindex.v0, scale);
  ret.v1 = _mm_i32gather_ps(base_addr, vindex.v1, scale);
  return __m256_from_internal(ret);
}

static __inline__ __m128
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i64gather_ps(const float* base_addr, __m128i vindex, const int scale) {
  float* lane[2];
  for (size_t i = 0; i < 2; i++) {
    lane[i] = (float*)((uint8_t*)base_addr +
                       ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
  }
  return (__m128)wasm_f32x4_make(*lane[0], *lane[1], 0, 0);
}

static __inline__ __m128
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i64gather_ps(const float* base_addr, __m256i __vindex, const int scale) {
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  float* lane[4];
  __m128i current_vindex;
  for (size_t i = 0; i < 4; i++) {
    current_vindex = i < 2 ? vindex.v0 : vindex.v1;
    lane[i] = (float*)((uint8_t*)base_addr + ((__i64x2)current_vindex)[i & 1] *
                                               (uint64_t)((uint32_t)scale));
  }
  return (__m128)wasm_f32x4_make(*lane[0], *lane[1], *lane[2], *lane[3]);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i32gather_epi32(const int* base_addr, __m128i vindex, const int scale) {
  int32_t* lane[4];
  for (size_t i = 0; i < 4; i++) {
    lane[i] = (int32_t*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                                 (uint64_t)((uint32_t)scale));
  }
  return (__m128i)wasm_i32x4_make(*lane[0], *lane[1], *lane[2], *lane[3]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i32gather_epi32(const int* base_addr,
                         __m256i __vindex,
                         const int scale) {
  __m256i_internal ret;
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  ret.v0 = _mm_i32gather_epi32(base_addr, vindex.v0, scale);
  ret.v1 = _mm_i32gather_epi32(base_addr, vindex.v1, scale);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i64gather_epi32(const int* base_addr, __m128i vindex, const int scale) {
  int32_t* lane[2];
  for (size_t i = 0; i < 2; i++) {
    lane[i] = (int32_t*)((uint8_t*)base_addr +
                         ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
  }
  return (__m128i)wasm_i32x4_make(*lane[0], *lane[1], 0, 0);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i64gather_epi32(const int* base_addr,
                         __m256i __vindex,
                         const int scale) {
  __m256i_internal vindex = __m256i_to_internal(__vindex);
  int32_t* lane[4];
  __m128i current_vindex;
  for (size_t i = 0; i < 4; i++) {
    current_vindex = i < 2 ? vindex.v0 : vindex.v1;
    lane[i] =
      (int32_t*)((uint8_t*)base_addr + ((__i64x2)current_vindex)[i & 1] *
                                         (uint64_t)((uint32_t)scale));
  }
  return (__m128i)wasm_i32x4_make(*lane[0], *lane[1], *lane[2], *lane[3]);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i32gather_epi64(const long long* base_addr,
                      __m128i vindex,
                      const int scale) {
  int64_t* lane[2];
  for (size_t i = 0; i < 2; i++) {
    lane[i] = (int64_t*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                                 (uint64_t)((uint32_t)scale));
  }
  return (__m128i)wasm_i64x2_make(*lane[0], *lane[1]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i32gather_epi64(const long long* base_addr,
                         __m128i vindex,
                         const int scale) {

  __m256i_internal ret;
  int64_t* lane[4];
  for (size_t i = 0; i < 4; i++) {
    lane[i] = (int64_t*)((uint8_t*)base_addr + (int64_t)(((__i32x4)vindex)[i]) *
                                                 (uint64_t)((uint32_t)scale));
  }
  ret.v0 = (__m128i)wasm_i64x2_make(*lane[0], *lane[1]);
  ret.v1 = (__m128i)wasm_i64x2_make(*lane[2], *lane[3]);
  return __m256i_from_internal(ret);
}

static __inline__ __m128i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm_i64gather_epi64(const long long* base_addr,
                      __m128i vindex,
                      const int scale) {
  int64_t* lane[2];
  for (size_t i = 0; i < 2; i++) {
    lane[i] = (int64_t*)((uint8_t*)base_addr +
                         ((__i64x2)vindex)[i] * (uint64_t)((uint32_t)scale));
  }
  return (__m128i)wasm_i64x2_make(*lane[0], *lane[1]);
}

static __inline__ __m256i
  __attribute__((__always_inline__, __nodebug__, DIAGNOSE_SLOW))
  _mm256_i64gather_epi64(const long long* base_addr,
                         __m256i __vindex,
                         const int scale) {
  __m256i_internal ret, vindex;
  vindex = __m256i_to_internal(__vindex);
  ret.v0 = _mm_i64gather_epi64(base_addr, vindex.v0, scale);
  ret.v1 = _mm_i64gather_epi64(base_addr, vindex.v1, scale);
  return __m256i_from_internal(ret);
}

#endif /* __emscripten_avx2intrin_h__ */
`,"wasm_simd128.h":`/*===---- wasm_simd128.h - WebAssembly portable SIMD intrinsics ------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __WASM_SIMD128_H
#define __WASM_SIMD128_H

#include <stdbool.h>
#include <stdint.h>

// User-facing type
typedef int32_t v128_t __attribute__((__vector_size__(16), __aligned__(16)));

// Internal types determined by clang builtin definitions
typedef int32_t __v128_u __attribute__((__vector_size__(16), __aligned__(1)));
typedef signed char __i8x16
    __attribute__((__vector_size__(16), __aligned__(16)));
typedef unsigned char __u8x16
    __attribute__((__vector_size__(16), __aligned__(16)));
typedef short __i16x8 __attribute__((__vector_size__(16), __aligned__(16)));
typedef unsigned short __u16x8
    __attribute__((__vector_size__(16), __aligned__(16)));
typedef int __i32x4 __attribute__((__vector_size__(16), __aligned__(16)));
typedef unsigned int __u32x4
    __attribute__((__vector_size__(16), __aligned__(16)));
typedef long long __i64x2 __attribute__((__vector_size__(16), __aligned__(16)));
typedef unsigned long long __u64x2
    __attribute__((__vector_size__(16), __aligned__(16)));
typedef float __f32x4 __attribute__((__vector_size__(16), __aligned__(16)));
typedef double __f64x2 __attribute__((__vector_size__(16), __aligned__(16)));
typedef __fp16 __f16x8 __attribute__((__vector_size__(16), __aligned__(16)));

typedef signed char __i8x8 __attribute__((__vector_size__(8), __aligned__(8)));
typedef unsigned char __u8x8
    __attribute__((__vector_size__(8), __aligned__(8)));
typedef short __i16x4 __attribute__((__vector_size__(8), __aligned__(8)));
typedef unsigned short __u16x4
    __attribute__((__vector_size__(8), __aligned__(8)));
typedef int __i32x2 __attribute__((__vector_size__(8), __aligned__(8)));
typedef unsigned int __u32x2
    __attribute__((__vector_size__(8), __aligned__(8)));
typedef float __f32x2 __attribute__((__vector_size__(8), __aligned__(8)));

#define __DEFAULT_FN_ATTRS                                                     \\
  __attribute__((__always_inline__, __nodebug__, __target__("simd128"),        \\
                 __min_vector_width__(128)))

#define __REQUIRE_CONSTANT(c)                                                  \\
  __attribute__((__diagnose_if__(!__builtin_constant_p(c),                     \\
                                 #c " must be constant", "error")))

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_load(const void *__mem) {
  // UB-free unaligned access copied from xmmintrin.h
  struct __wasm_v128_load_struct {
    __v128_u __v;
  } __attribute__((__packed__, __may_alias__));
  return ((const struct __wasm_v128_load_struct *)__mem)->__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_v128_load8_splat(const void *__mem) {
  struct __wasm_v128_load8_splat_struct {
    uint8_t __v;
  } __attribute__((__packed__, __may_alias__));
  uint8_t __v = ((const struct __wasm_v128_load8_splat_struct *)__mem)->__v;
  return (v128_t)(__u8x16){__v, __v, __v, __v, __v, __v, __v, __v,
                           __v, __v, __v, __v, __v, __v, __v, __v};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_v128_load16_splat(const void *__mem) {
  struct __wasm_v128_load16_splat_struct {
    uint16_t __v;
  } __attribute__((__packed__, __may_alias__));
  uint16_t __v = ((const struct __wasm_v128_load16_splat_struct *)__mem)->__v;
  return (v128_t)(__u16x8){__v, __v, __v, __v, __v, __v, __v, __v};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_v128_load32_splat(const void *__mem) {
  struct __wasm_v128_load32_splat_struct {
    uint32_t __v;
  } __attribute__((__packed__, __may_alias__));
  uint32_t __v = ((const struct __wasm_v128_load32_splat_struct *)__mem)->__v;
  return (v128_t)(__u32x4){__v, __v, __v, __v};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_v128_load64_splat(const void *__mem) {
  struct __wasm_v128_load64_splat_struct {
    uint64_t __v;
  } __attribute__((__packed__, __may_alias__));
  uint64_t __v = ((const struct __wasm_v128_load64_splat_struct *)__mem)->__v;
  return (v128_t)(__u64x2){__v, __v};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_load8x8(const void *__mem) {
  struct __wasm_i16x8_load8x8_struct {
    __i8x8 __v;
  } __attribute__((__packed__, __may_alias__));
  __i8x8 __v = ((const struct __wasm_i16x8_load8x8_struct *)__mem)->__v;
  return (v128_t) __builtin_convertvector(__v, __i16x8);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_load8x8(const void *__mem) {
  struct __wasm_u16x8_load8x8_struct {
    __u8x8 __v;
  } __attribute__((__packed__, __may_alias__));
  __u8x8 __v = ((const struct __wasm_u16x8_load8x8_struct *)__mem)->__v;
  return (v128_t) __builtin_convertvector(__v, __u16x8);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_load16x4(const void *__mem) {
  struct __wasm_i32x4_load16x4_struct {
    __i16x4 __v;
  } __attribute__((__packed__, __may_alias__));
  __i16x4 __v = ((const struct __wasm_i32x4_load16x4_struct *)__mem)->__v;
  return (v128_t) __builtin_convertvector(__v, __i32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_load16x4(const void *__mem) {
  struct __wasm_u32x4_load16x4_struct {
    __u16x4 __v;
  } __attribute__((__packed__, __may_alias__));
  __u16x4 __v = ((const struct __wasm_u32x4_load16x4_struct *)__mem)->__v;
  return (v128_t) __builtin_convertvector(__v, __u32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i64x2_load32x2(const void *__mem) {
  struct __wasm_i64x2_load32x2_struct {
    __i32x2 __v;
  } __attribute__((__packed__, __may_alias__));
  __i32x2 __v = ((const struct __wasm_i64x2_load32x2_struct *)__mem)->__v;
  return (v128_t) __builtin_convertvector(__v, __i64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u64x2_load32x2(const void *__mem) {
  struct __wasm_u64x2_load32x2_struct {
    __u32x2 __v;
  } __attribute__((__packed__, __may_alias__));
  __u32x2 __v = ((const struct __wasm_u64x2_load32x2_struct *)__mem)->__v;
  return (v128_t) __builtin_convertvector(__v, __u64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_v128_load32_zero(const void *__mem) {
  struct __wasm_v128_load32_zero_struct {
    int32_t __v;
  } __attribute__((__packed__, __may_alias__));
  int32_t __v = ((const struct __wasm_v128_load32_zero_struct *)__mem)->__v;
  return (v128_t)(__i32x4){__v, 0, 0, 0};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_v128_load64_zero(const void *__mem) {
  struct __wasm_v128_load64_zero_struct {
    int64_t __v;
  } __attribute__((__packed__, __may_alias__));
  int64_t __v = ((const struct __wasm_v128_load64_zero_struct *)__mem)->__v;
  return (v128_t)(__i64x2){__v, 0};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_load8_lane(
    const void *__mem, v128_t __vec, int __i) __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_load8_lane_struct {
    int8_t __v;
  } __attribute__((__packed__, __may_alias__));
  int8_t __v = ((const struct __wasm_v128_load8_lane_struct *)__mem)->__v;
  __i8x16 __ret = (__i8x16)__vec;
  __ret[__i] = __v;
  return (v128_t)__ret;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_load16_lane(
    const void *__mem, v128_t __vec, int __i) __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_load16_lane_struct {
    int16_t __v;
  } __attribute__((__packed__, __may_alias__));
  int16_t __v = ((const struct __wasm_v128_load16_lane_struct *)__mem)->__v;
  __i16x8 __ret = (__i16x8)__vec;
  __ret[__i] = __v;
  return (v128_t)__ret;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_load32_lane(
    const void *__mem, v128_t __vec, int __i) __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_load32_lane_struct {
    int32_t __v;
  } __attribute__((__packed__, __may_alias__));
  int32_t __v = ((const struct __wasm_v128_load32_lane_struct *)__mem)->__v;
  __i32x4 __ret = (__i32x4)__vec;
  __ret[__i] = __v;
  return (v128_t)__ret;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_load64_lane(
    const void *__mem, v128_t __vec, int __i) __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_load64_lane_struct {
    int64_t __v;
  } __attribute__((__packed__, __may_alias__));
  int64_t __v = ((const struct __wasm_v128_load64_lane_struct *)__mem)->__v;
  __i64x2 __ret = (__i64x2)__vec;
  __ret[__i] = __v;
  return (v128_t)__ret;
}

static __inline__ void __DEFAULT_FN_ATTRS wasm_v128_store(void *__mem,
                                                          v128_t __a) {
  // UB-free unaligned access copied from xmmintrin.h
  struct __wasm_v128_store_struct {
    __v128_u __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __wasm_v128_store_struct *)__mem)->__v = __a;
}

static __inline__ void __DEFAULT_FN_ATTRS wasm_v128_store8_lane(void *__mem,
                                                                v128_t __vec,
                                                                int __i)
    __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_store8_lane_struct {
    int8_t __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __wasm_v128_store8_lane_struct *)__mem)->__v = ((__i8x16)__vec)[__i];
}

static __inline__ void __DEFAULT_FN_ATTRS wasm_v128_store16_lane(void *__mem,
                                                                 v128_t __vec,
                                                                 int __i)
    __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_store16_lane_struct {
    int16_t __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __wasm_v128_store16_lane_struct *)__mem)->__v =
      ((__i16x8)__vec)[__i];
}

static __inline__ void __DEFAULT_FN_ATTRS wasm_v128_store32_lane(void *__mem,
                                                                 v128_t __vec,
                                                                 int __i)
    __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_store32_lane_struct {
    int32_t __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __wasm_v128_store32_lane_struct *)__mem)->__v =
      ((__i32x4)__vec)[__i];
}

static __inline__ void __DEFAULT_FN_ATTRS wasm_v128_store64_lane(void *__mem,
                                                                 v128_t __vec,
                                                                 int __i)
    __REQUIRE_CONSTANT(__i) {
  struct __wasm_v128_store64_lane_struct {
    int64_t __v;
  } __attribute__((__packed__, __may_alias__));
  ((struct __wasm_v128_store64_lane_struct *)__mem)->__v =
      ((__i64x2)__vec)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i8x16_make(int8_t __c0, int8_t __c1, int8_t __c2, int8_t __c3, int8_t __c4,
                int8_t __c5, int8_t __c6, int8_t __c7, int8_t __c8, int8_t __c9,
                int8_t __c10, int8_t __c11, int8_t __c12, int8_t __c13,
                int8_t __c14, int8_t __c15) {
  return (v128_t)(__i8x16){__c0,  __c1,  __c2,  __c3, __c4,  __c5,
                           __c6,  __c7,  __c8,  __c9, __c10, __c11,
                           __c12, __c13, __c14, __c15};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u8x16_make(uint8_t __c0, uint8_t __c1, uint8_t __c2, uint8_t __c3,
                uint8_t __c4, uint8_t __c5, uint8_t __c6, uint8_t __c7,
                uint8_t __c8, uint8_t __c9, uint8_t __c10, uint8_t __c11,
                uint8_t __c12, uint8_t __c13, uint8_t __c14, uint8_t __c15) {
  return (v128_t)(__u8x16){__c0,  __c1,  __c2,  __c3, __c4,  __c5,
                           __c6,  __c7,  __c8,  __c9, __c10, __c11,
                           __c12, __c13, __c14, __c15};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_make(int16_t __c0, int16_t __c1, int16_t __c2, int16_t __c3,
                int16_t __c4, int16_t __c5, int16_t __c6, int16_t __c7) {
  return (v128_t)(__i16x8){__c0, __c1, __c2, __c3, __c4, __c5, __c6, __c7};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_make(uint16_t __c0, uint16_t __c1, uint16_t __c2, uint16_t __c3,
                uint16_t __c4, uint16_t __c5, uint16_t __c6, uint16_t __c7) {
  return (v128_t)(__u16x8){__c0, __c1, __c2, __c3, __c4, __c5, __c6, __c7};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_make(int32_t __c0,
                                                            int32_t __c1,
                                                            int32_t __c2,
                                                            int32_t __c3) {
  return (v128_t)(__i32x4){__c0, __c1, __c2, __c3};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_make(uint32_t __c0,
                                                            uint32_t __c1,
                                                            uint32_t __c2,
                                                            uint32_t __c3) {
  return (v128_t)(__u32x4){__c0, __c1, __c2, __c3};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_make(int64_t __c0,
                                                            int64_t __c1) {
  return (v128_t)(__i64x2){__c0, __c1};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u64x2_make(uint64_t __c0,
                                                            uint64_t __c1) {
  return (v128_t)(__u64x2){__c0, __c1};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_make(float __c0,
                                                            float __c1,
                                                            float __c2,
                                                            float __c3) {
  return (v128_t)(__f32x4){__c0, __c1, __c2, __c3};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_make(double __c0,
                                                            double __c1) {
  return (v128_t)(__f64x2){__c0, __c1};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i8x16_const(int8_t __c0, int8_t __c1, int8_t __c2, int8_t __c3,
                 int8_t __c4, int8_t __c5, int8_t __c6, int8_t __c7,
                 int8_t __c8, int8_t __c9, int8_t __c10, int8_t __c11,
                 int8_t __c12, int8_t __c13, int8_t __c14, int8_t __c15)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) __REQUIRE_CONSTANT(__c4)
            __REQUIRE_CONSTANT(__c5) __REQUIRE_CONSTANT(__c6)
                __REQUIRE_CONSTANT(__c7) __REQUIRE_CONSTANT(__c8)
                    __REQUIRE_CONSTANT(__c9) __REQUIRE_CONSTANT(__c10)
                        __REQUIRE_CONSTANT(__c11) __REQUIRE_CONSTANT(__c12)
                            __REQUIRE_CONSTANT(__c13) __REQUIRE_CONSTANT(__c14)
                                __REQUIRE_CONSTANT(__c15) {
  return (v128_t)(__i8x16){__c0,  __c1,  __c2,  __c3, __c4,  __c5,
                           __c6,  __c7,  __c8,  __c9, __c10, __c11,
                           __c12, __c13, __c14, __c15};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u8x16_const(uint8_t __c0, uint8_t __c1, uint8_t __c2, uint8_t __c3,
                 uint8_t __c4, uint8_t __c5, uint8_t __c6, uint8_t __c7,
                 uint8_t __c8, uint8_t __c9, uint8_t __c10, uint8_t __c11,
                 uint8_t __c12, uint8_t __c13, uint8_t __c14, uint8_t __c15)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) __REQUIRE_CONSTANT(__c4)
            __REQUIRE_CONSTANT(__c5) __REQUIRE_CONSTANT(__c6)
                __REQUIRE_CONSTANT(__c7) __REQUIRE_CONSTANT(__c8)
                    __REQUIRE_CONSTANT(__c9) __REQUIRE_CONSTANT(__c10)
                        __REQUIRE_CONSTANT(__c11) __REQUIRE_CONSTANT(__c12)
                            __REQUIRE_CONSTANT(__c13) __REQUIRE_CONSTANT(__c14)
                                __REQUIRE_CONSTANT(__c15) {
  return (v128_t)(__u8x16){__c0,  __c1,  __c2,  __c3, __c4,  __c5,
                           __c6,  __c7,  __c8,  __c9, __c10, __c11,
                           __c12, __c13, __c14, __c15};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_const(int16_t __c0, int16_t __c1, int16_t __c2, int16_t __c3,
                 int16_t __c4, int16_t __c5, int16_t __c6, int16_t __c7)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) __REQUIRE_CONSTANT(__c4)
            __REQUIRE_CONSTANT(__c5) __REQUIRE_CONSTANT(__c6)
                __REQUIRE_CONSTANT(__c7) {
  return (v128_t)(__i16x8){__c0, __c1, __c2, __c3, __c4, __c5, __c6, __c7};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_const(uint16_t __c0, uint16_t __c1, uint16_t __c2, uint16_t __c3,
                 uint16_t __c4, uint16_t __c5, uint16_t __c6, uint16_t __c7)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) __REQUIRE_CONSTANT(__c4)
            __REQUIRE_CONSTANT(__c5) __REQUIRE_CONSTANT(__c6)
                __REQUIRE_CONSTANT(__c7) {
  return (v128_t)(__u16x8){__c0, __c1, __c2, __c3, __c4, __c5, __c6, __c7};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_const(int32_t __c0, int32_t __c1, int32_t __c2, int32_t __c3)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) {
  return (v128_t)(__i32x4){__c0, __c1, __c2, __c3};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_const(uint32_t __c0, uint32_t __c1, uint32_t __c2, uint32_t __c3)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) {
  return (v128_t)(__u32x4){__c0, __c1, __c2, __c3};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_const(int64_t __c0,
                                                             int64_t __c1)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) {
  return (v128_t)(__i64x2){__c0, __c1};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u64x2_const(uint64_t __c0,
                                                             uint64_t __c1)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) {
  return (v128_t)(__u64x2){__c0, __c1};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f32x4_const(float __c0, float __c1, float __c2, float __c3)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) __REQUIRE_CONSTANT(__c2)
        __REQUIRE_CONSTANT(__c3) {
  return (v128_t)(__f32x4){__c0, __c1, __c2, __c3};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_const(double __c0,
                                                             double __c1)
    __REQUIRE_CONSTANT(__c0) __REQUIRE_CONSTANT(__c1) {
  return (v128_t)(__f64x2){__c0, __c1};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_const_splat(int8_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__i8x16){__c, __c, __c, __c, __c, __c, __c, __c,
                           __c, __c, __c, __c, __c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_const_splat(uint8_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__u8x16){__c, __c, __c, __c, __c, __c, __c, __c,
                           __c, __c, __c, __c, __c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_const_splat(int16_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__i16x8){__c, __c, __c, __c, __c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_const_splat(uint16_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__u16x8){__c, __c, __c, __c, __c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_const_splat(int32_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__i32x4){__c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_const_splat(uint32_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__u32x4){__c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_const_splat(int64_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__i64x2){__c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u64x2_const_splat(uint64_t __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__u64x2){__c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_const_splat(float __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__f32x4){__c, __c, __c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_const_splat(double __c)
    __REQUIRE_CONSTANT(__c) {
  return (v128_t)(__f64x2){__c, __c};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_splat(int8_t __a) {
  return (v128_t)(__i8x16){__a, __a, __a, __a, __a, __a, __a, __a,
                           __a, __a, __a, __a, __a, __a, __a, __a};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_splat(uint8_t __a) {
  return (v128_t)(__u8x16){__a, __a, __a, __a, __a, __a, __a, __a,
                           __a, __a, __a, __a, __a, __a, __a, __a};
}

static __inline__ int8_t __DEFAULT_FN_ATTRS wasm_i8x16_extract_lane(v128_t __a,
                                                                    int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__i8x16)__a)[__i];
}

static __inline__ uint8_t __DEFAULT_FN_ATTRS wasm_u8x16_extract_lane(v128_t __a,
                                                                     int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__u8x16)__a)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    int8_t __b)
    __REQUIRE_CONSTANT(__i) {
  __i8x16 __v = (__i8x16)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    uint8_t __b)
    __REQUIRE_CONSTANT(__i) {
  __u8x16 __v = (__u8x16)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_splat(int16_t __a) {
  return (v128_t)(__i16x8){__a, __a, __a, __a, __a, __a, __a, __a};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_splat(uint16_t __a) {
  return (v128_t)(__u16x8){__a, __a, __a, __a, __a, __a, __a, __a};
}

static __inline__ int16_t __DEFAULT_FN_ATTRS wasm_i16x8_extract_lane(v128_t __a,
                                                                     int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__i16x8)__a)[__i];
}

static __inline__ uint16_t __DEFAULT_FN_ATTRS
wasm_u16x8_extract_lane(v128_t __a, int __i) __REQUIRE_CONSTANT(__i) {
  return ((__u16x8)__a)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    int16_t __b)
    __REQUIRE_CONSTANT(__i) {
  __i16x8 __v = (__i16x8)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_replace_lane(
    v128_t __a, int __i, uint16_t __b) __REQUIRE_CONSTANT(__i) {
  __u16x8 __v = (__u16x8)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_splat(int32_t __a) {
  return (v128_t)(__i32x4){__a, __a, __a, __a};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_splat(uint32_t __a) {
  return (v128_t)(__u32x4){__a, __a, __a, __a};
}

static __inline__ int32_t __DEFAULT_FN_ATTRS wasm_i32x4_extract_lane(v128_t __a,
                                                                     int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__i32x4)__a)[__i];
}

static __inline__ uint32_t __DEFAULT_FN_ATTRS
wasm_u32x4_extract_lane(v128_t __a, int __i) __REQUIRE_CONSTANT(__i) {
  return ((__u32x4)__a)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    int32_t __b)
    __REQUIRE_CONSTANT(__i) {
  __i32x4 __v = (__i32x4)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_replace_lane(
    v128_t __a, int __i, uint32_t __b) __REQUIRE_CONSTANT(__i) {
  __u32x4 __v = (__u32x4)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_splat(int64_t __a) {
  return (v128_t)(__i64x2){__a, __a};
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u64x2_splat(uint64_t __a) {
  return (v128_t)(__u64x2){__a, __a};
}

static __inline__ int64_t __DEFAULT_FN_ATTRS wasm_i64x2_extract_lane(v128_t __a,
                                                                     int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__i64x2)__a)[__i];
}

static __inline__ uint64_t __DEFAULT_FN_ATTRS
wasm_u64x2_extract_lane(v128_t __a, int __i) __REQUIRE_CONSTANT(__i) {
  return ((__u64x2)__a)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    int64_t __b)
    __REQUIRE_CONSTANT(__i) {
  __i64x2 __v = (__i64x2)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u64x2_replace_lane(
    v128_t __a, int __i, uint64_t __b) __REQUIRE_CONSTANT(__i) {
  __u64x2 __v = (__u64x2)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_splat(float __a) {
  return (v128_t)(__f32x4){__a, __a, __a, __a};
}

static __inline__ float __DEFAULT_FN_ATTRS wasm_f32x4_extract_lane(v128_t __a,
                                                                   int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__f32x4)__a)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    float __b)
    __REQUIRE_CONSTANT(__i) {
  __f32x4 __v = (__f32x4)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_splat(double __a) {
  return (v128_t)(__f64x2){__a, __a};
}

static __inline__ double __DEFAULT_FN_ATTRS wasm_f64x2_extract_lane(v128_t __a,
                                                                    int __i)
    __REQUIRE_CONSTANT(__i) {
  return ((__f64x2)__a)[__i];
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_replace_lane(v128_t __a,
                                                                    int __i,
                                                                    double __b)
    __REQUIRE_CONSTANT(__i) {
  __f64x2 __v = (__f64x2)__a;
  __v[__i] = __b;
  return (v128_t)__v;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_eq(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i8x16)__a == (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_ne(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i8x16)__a != (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i8x16)__a < (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u8x16)__a < (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i8x16)__a > (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u8x16)__a > (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i8x16)__a <= (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u8x16)__a <= (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i8x16)__a >= (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u8x16)__a >= (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_eq(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i16x8)__a == (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_ne(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u16x8)__a != (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i16x8)__a < (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u16x8)__a < (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i16x8)__a > (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u16x8)__a > (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i16x8)__a <= (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u16x8)__a <= (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i16x8)__a >= (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u16x8)__a >= (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_eq(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i32x4)__a == (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_ne(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i32x4)__a != (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i32x4)__a < (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u32x4)__a < (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i32x4)__a > (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u32x4)__a > (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i32x4)__a <= (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u32x4)__a <= (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i32x4)__a >= (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__u32x4)__a >= (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_eq(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i64x2)__a == (__i64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_ne(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i64x2)__a != (__i64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i64x2)__a < (__i64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i64x2)__a > (__i64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i64x2)__a <= (__i64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__i64x2)__a >= (__i64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_eq(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f32x4)__a == (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_ne(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f32x4)__a != (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f32x4)__a < (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f32x4)__a > (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f32x4)__a <= (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f32x4)__a >= (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_eq(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f64x2)__a == (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_ne(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f64x2)__a != (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_lt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f64x2)__a < (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_gt(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f64x2)__a > (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_le(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f64x2)__a <= (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_ge(v128_t __a,
                                                          v128_t __b) {
  return (v128_t)((__f64x2)__a >= (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_not(v128_t __a) {
  return ~__a;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_and(v128_t __a,
                                                          v128_t __b) {
  return __a & __b;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_or(v128_t __a,
                                                         v128_t __b) {
  return __a | __b;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_xor(v128_t __a,
                                                          v128_t __b) {
  return __a ^ __b;
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_andnot(v128_t __a,
                                                             v128_t __b) {
  return __a & ~__b;
}

static __inline__ bool __DEFAULT_FN_ATTRS wasm_v128_any_true(v128_t __a) {
  return __builtin_wasm_any_true_v128((__i8x16)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_v128_bitselect(v128_t __a,
                                                                v128_t __b,
                                                                v128_t __mask) {
  return (v128_t)__builtin_wasm_bitselect((__i32x4)__a, (__i32x4)__b,
                                          (__i32x4)__mask);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_i8x16((__i8x16)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_neg(v128_t __a) {
  return (v128_t)(-(__u8x16)__a);
}

static __inline__ bool __DEFAULT_FN_ATTRS wasm_i8x16_all_true(v128_t __a) {
  return __builtin_wasm_all_true_i8x16((__i8x16)__a);
}

static __inline__ uint32_t __DEFAULT_FN_ATTRS wasm_i8x16_bitmask(v128_t __a) {
  return __builtin_wasm_bitmask_i8x16((__i8x16)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_popcnt(v128_t __a) {
  return (v128_t)__builtin_elementwise_popcount((__i8x16)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_shl(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i8x16)__a << (__b & 0x7));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i8x16)__a >> (__b & 0x7));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__u8x16)__a >> (__b & 0x7));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_add(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u8x16)__a + (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_add_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_add_sat((__i8x16)__a, (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_add_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_add_sat((__u8x16)__a, (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_sub(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u8x16)__a - (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_sub_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_sub_sat((__i8x16)__a, (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_sub_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_sub_sat((__u8x16)__a, (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_min((__i8x16)__a, (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_min((__u8x16)__a, (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_max((__i8x16)__a, (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_max((__u8x16)__a, (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u8x16_avgr(v128_t __a,
                                                            v128_t __b) {
  return (v128_t)__builtin_wasm_avgr_u_i8x16((__u8x16)__a, (__u8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_i16x8((__i16x8)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_neg(v128_t __a) {
  return (v128_t)(-(__u16x8)__a);
}

static __inline__ bool __DEFAULT_FN_ATTRS wasm_i16x8_all_true(v128_t __a) {
  return __builtin_wasm_all_true_i16x8((__i16x8)__a);
}

static __inline__ uint32_t __DEFAULT_FN_ATTRS wasm_i16x8_bitmask(v128_t __a) {
  return __builtin_wasm_bitmask_i16x8((__i16x8)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_shl(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i16x8)__a << (__b & 0xF));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i16x8)__a >> (__b & 0xF));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__u16x8)__a >> (__b & 0xF));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_add(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u16x8)__a + (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_add_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_add_sat((__i16x8)__a, (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_add_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_add_sat((__u16x8)__a, (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_sub(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__i16x8)__a - (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_sub_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_sub_sat((__i16x8)__a, (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_sub_sat(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_elementwise_sub_sat((__u16x8)__a, (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_mul(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u16x8)__a * (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_min((__i16x8)__a, (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_min((__u16x8)__a, (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_max((__i16x8)__a, (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_max((__u16x8)__a, (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u16x8_avgr(v128_t __a,
                                                            v128_t __b) {
  return (v128_t)__builtin_wasm_avgr_u_i16x8((__u16x8)__a, (__u16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_i32x4((__i32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_neg(v128_t __a) {
  return (v128_t)(-(__u32x4)__a);
}

static __inline__ bool __DEFAULT_FN_ATTRS wasm_i32x4_all_true(v128_t __a) {
  return __builtin_wasm_all_true_i32x4((__i32x4)__a);
}

static __inline__ uint32_t __DEFAULT_FN_ATTRS wasm_i32x4_bitmask(v128_t __a) {
  return __builtin_wasm_bitmask_i32x4((__i32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_shl(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i32x4)__a << (__b & 0x1F));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i32x4)__a >> (__b & 0x1F));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__u32x4)__a >> (__b & 0x1F));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_add(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u32x4)__a + (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_sub(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u32x4)__a - (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_mul(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u32x4)__a * (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_min((__i32x4)__a, (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_min((__u32x4)__a, (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_max((__i32x4)__a, (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u32x4_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_elementwise_max((__u32x4)__a, (__u32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i32x4_dot_i16x8(v128_t __a,
                                                                 v128_t __b) {
  return (v128_t)__builtin_wasm_dot_s_i32x4_i16x8((__i16x8)__a, (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_i64x2((__i64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_neg(v128_t __a) {
  return (v128_t)(-(__u64x2)__a);
}

static __inline__ bool __DEFAULT_FN_ATTRS wasm_i64x2_all_true(v128_t __a) {
  return __builtin_wasm_all_true_i64x2((__i64x2)__a);
}

static __inline__ uint32_t __DEFAULT_FN_ATTRS wasm_i64x2_bitmask(v128_t __a) {
  return __builtin_wasm_bitmask_i64x2((__i64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_shl(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i64x2)__a << ((int64_t)__b & 0x3F));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__i64x2)__a >> ((int64_t)__b & 0x3F));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_u64x2_shr(v128_t __a,
                                                           uint32_t __b) {
  return (v128_t)((__u64x2)__a >> ((int64_t)__b & 0x3F));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_add(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u64x2)__a + (__u64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_sub(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u64x2)__a - (__u64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i64x2_mul(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__u64x2)__a * (__u64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_neg(v128_t __a) {
  return (v128_t)(-(__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_sqrt(v128_t __a) {
  return (v128_t)__builtin_wasm_sqrt_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_ceil(v128_t __a) {
  return (v128_t)__builtin_wasm_ceil_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_floor(v128_t __a) {
  return (v128_t)__builtin_wasm_floor_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_trunc(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_nearest(v128_t __a) {
  return (v128_t)__builtin_wasm_nearest_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_add(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f32x4)__a + (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_sub(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f32x4)__a - (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_mul(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f32x4)__a * (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_div(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f32x4)__a / (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_wasm_min_f32x4((__f32x4)__a, (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_wasm_max_f32x4((__f32x4)__a, (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_pmin(v128_t __a,
                                                            v128_t __b) {
  return (v128_t)__builtin_wasm_pmin_f32x4((__f32x4)__a, (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f32x4_pmax(v128_t __a,
                                                            v128_t __b) {
  return (v128_t)__builtin_wasm_pmax_f32x4((__f32x4)__a, (__f32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_f64x2((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_neg(v128_t __a) {
  return (v128_t)(-(__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_sqrt(v128_t __a) {
  return (v128_t)__builtin_wasm_sqrt_f64x2((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_ceil(v128_t __a) {
  return (v128_t)__builtin_wasm_ceil_f64x2((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_floor(v128_t __a) {
  return (v128_t)__builtin_wasm_floor_f64x2((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_trunc(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_f64x2((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_nearest(v128_t __a) {
  return (v128_t)__builtin_wasm_nearest_f64x2((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_add(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f64x2)__a + (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_sub(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f64x2)__a - (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_mul(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f64x2)__a * (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_div(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)((__f64x2)__a / (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_min(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_wasm_min_f64x2((__f64x2)__a, (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_max(v128_t __a,
                                                           v128_t __b) {
  return (v128_t)__builtin_wasm_max_f64x2((__f64x2)__a, (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_pmin(v128_t __a,
                                                            v128_t __b) {
  return (v128_t)__builtin_wasm_pmin_f64x2((__f64x2)__a, (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_f64x2_pmax(v128_t __a,
                                                            v128_t __b) {
  return (v128_t)__builtin_wasm_pmax_f64x2((__f64x2)__a, (__f64x2)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_trunc_sat_f32x4(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_saturate_s_i32x4_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_trunc_sat_f32x4(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_saturate_u_i32x4_f32x4((__f32x4)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f32x4_convert_i32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector((__i32x4)__a, __f32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f32x4_convert_u32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector((__u32x4)__a, __f32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f64x2_convert_low_i32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector((__i32x2){__a[0], __a[1]}, __f64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f64x2_convert_low_u32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector((__u32x2){__a[0], __a[1]}, __f64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_trunc_sat_f64x2_zero(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_sat_s_zero_f64x2_i32x4((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_trunc_sat_f64x2_zero(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_sat_u_zero_f64x2_i32x4((__f64x2)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f32x4_demote_f64x2_zero(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      __builtin_shufflevector((__f64x2)__a, (__f64x2){0, 0}, 0, 1, 2, 3),
      __f32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_f64x2_promote_low_f32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__f32x2){((__f32x4)__a)[0], ((__f32x4)__a)[1]}, __f64x2);
}

#define wasm_i8x16_shuffle(__a, __b, __c0, __c1, __c2, __c3, __c4, __c5, __c6, \\
                           __c7, __c8, __c9, __c10, __c11, __c12, __c13,       \\
                           __c14, __c15)                                       \\
  ((v128_t)__builtin_wasm_shuffle_i8x16(                                       \\
      (__i8x16)(__a), (__i8x16)(__b), __c0, __c1, __c2, __c3, __c4, __c5,      \\
      __c6, __c7, __c8, __c9, __c10, __c11, __c12, __c13, __c14, __c15))

#define wasm_i16x8_shuffle(__a, __b, __c0, __c1, __c2, __c3, __c4, __c5, __c6, \\
                           __c7)                                               \\
  ((v128_t)__builtin_wasm_shuffle_i8x16(                                       \\
      (__i8x16)(__a), (__i8x16)(__b), (__c0)*2, (__c0)*2 + 1, (__c1)*2,        \\
      (__c1)*2 + 1, (__c2)*2, (__c2)*2 + 1, (__c3)*2, (__c3)*2 + 1, (__c4)*2,  \\
      (__c4)*2 + 1, (__c5)*2, (__c5)*2 + 1, (__c6)*2, (__c6)*2 + 1, (__c7)*2,  \\
      (__c7)*2 + 1))

#define wasm_i32x4_shuffle(__a, __b, __c0, __c1, __c2, __c3)                   \\
  ((v128_t)__builtin_wasm_shuffle_i8x16(                                       \\
      (__i8x16)(__a), (__i8x16)(__b), (__c0)*4, (__c0)*4 + 1, (__c0)*4 + 2,    \\
      (__c0)*4 + 3, (__c1)*4, (__c1)*4 + 1, (__c1)*4 + 2, (__c1)*4 + 3,        \\
      (__c2)*4, (__c2)*4 + 1, (__c2)*4 + 2, (__c2)*4 + 3, (__c3)*4,            \\
      (__c3)*4 + 1, (__c3)*4 + 2, (__c3)*4 + 3))

#define wasm_i64x2_shuffle(__a, __b, __c0, __c1)                               \\
  ((v128_t)__builtin_wasm_shuffle_i8x16(                                       \\
      (__i8x16)(__a), (__i8x16)(__b), (__c0)*8, (__c0)*8 + 1, (__c0)*8 + 2,    \\
      (__c0)*8 + 3, (__c0)*8 + 4, (__c0)*8 + 5, (__c0)*8 + 6, (__c0)*8 + 7,    \\
      (__c1)*8, (__c1)*8 + 1, (__c1)*8 + 2, (__c1)*8 + 3, (__c1)*8 + 4,        \\
      (__c1)*8 + 5, (__c1)*8 + 6, (__c1)*8 + 7))

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i8x16_swizzle(v128_t __a,
                                                               v128_t __b) {
  return (v128_t)__builtin_wasm_swizzle_i8x16((__i8x16)__a, (__i8x16)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i8x16_narrow_i16x8(v128_t __a, v128_t __b) {
  return (v128_t)__builtin_wasm_narrow_s_i8x16_i16x8((__i16x8)__a,
                                                     (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u8x16_narrow_i16x8(v128_t __a, v128_t __b) {
  return (v128_t)__builtin_wasm_narrow_u_i8x16_i16x8((__i16x8)__a,
                                                     (__i16x8)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_narrow_i32x4(v128_t __a, v128_t __b) {
  return (v128_t)__builtin_wasm_narrow_s_i16x8_i32x4((__i32x4)__a,
                                                     (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_narrow_i32x4(v128_t __a, v128_t __b) {
  return (v128_t)__builtin_wasm_narrow_u_i16x8_i32x4((__i32x4)__a,
                                                     (__i32x4)__b);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_extend_low_i8x16(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__i8x8){((__i8x16)__a)[0], ((__i8x16)__a)[1], ((__i8x16)__a)[2],
               ((__i8x16)__a)[3], ((__i8x16)__a)[4], ((__i8x16)__a)[5],
               ((__i8x16)__a)[6], ((__i8x16)__a)[7]},
      __i16x8);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_extend_high_i8x16(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__i8x8){((__i8x16)__a)[8], ((__i8x16)__a)[9], ((__i8x16)__a)[10],
               ((__i8x16)__a)[11], ((__i8x16)__a)[12], ((__i8x16)__a)[13],
               ((__i8x16)__a)[14], ((__i8x16)__a)[15]},
      __i16x8);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_extend_low_u8x16(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__u8x8){((__u8x16)__a)[0], ((__u8x16)__a)[1], ((__u8x16)__a)[2],
               ((__u8x16)__a)[3], ((__u8x16)__a)[4], ((__u8x16)__a)[5],
               ((__u8x16)__a)[6], ((__u8x16)__a)[7]},
      __u16x8);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_extend_high_u8x16(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__u8x8){((__u8x16)__a)[8], ((__u8x16)__a)[9], ((__u8x16)__a)[10],
               ((__u8x16)__a)[11], ((__u8x16)__a)[12], ((__u8x16)__a)[13],
               ((__u8x16)__a)[14], ((__u8x16)__a)[15]},
      __u16x8);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_extend_low_i16x8(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__i16x4){((__i16x8)__a)[0], ((__i16x8)__a)[1], ((__i16x8)__a)[2],
                ((__i16x8)__a)[3]},
      __i32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_extend_high_i16x8(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__i16x4){((__i16x8)__a)[4], ((__i16x8)__a)[5], ((__i16x8)__a)[6],
                ((__i16x8)__a)[7]},
      __i32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_extend_low_u16x8(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__u16x4){((__u16x8)__a)[0], ((__u16x8)__a)[1], ((__u16x8)__a)[2],
                ((__u16x8)__a)[3]},
      __u32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_extend_high_u16x8(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__u16x4){((__u16x8)__a)[4], ((__u16x8)__a)[5], ((__u16x8)__a)[6],
                ((__u16x8)__a)[7]},
      __u32x4);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i64x2_extend_low_i32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__i32x2){((__i32x4)__a)[0], ((__i32x4)__a)[1]}, __i64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i64x2_extend_high_i32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__i32x2){((__i32x4)__a)[2], ((__i32x4)__a)[3]}, __i64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u64x2_extend_low_u32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__u32x2){((__u32x4)__a)[0], ((__u32x4)__a)[1]}, __u64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u64x2_extend_high_u32x4(v128_t __a) {
  return (v128_t) __builtin_convertvector(
      (__u32x2){((__u32x4)__a)[2], ((__u32x4)__a)[3]}, __u64x2);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_extadd_pairwise_i8x16(v128_t __a) {
  return (v128_t)__builtin_wasm_extadd_pairwise_i8x16_s_i16x8((__i8x16)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_extadd_pairwise_u8x16(v128_t __a) {
  return (v128_t)__builtin_wasm_extadd_pairwise_i8x16_u_i16x8((__u8x16)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_extadd_pairwise_i16x8(v128_t __a) {
  return (v128_t)__builtin_wasm_extadd_pairwise_i16x8_s_i32x4((__i16x8)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_extadd_pairwise_u16x8(v128_t __a) {
  return (v128_t)__builtin_wasm_extadd_pairwise_i16x8_u_i32x4((__u16x8)__a);
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_extmul_low_i8x16(v128_t __a, v128_t __b) {
  return (v128_t)((__i16x8)wasm_i16x8_extend_low_i8x16(__a) *
                  (__i16x8)wasm_i16x8_extend_low_i8x16(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i16x8_extmul_high_i8x16(v128_t __a, v128_t __b) {
  return (v128_t)((__i16x8)wasm_i16x8_extend_high_i8x16(__a) *
                  (__i16x8)wasm_i16x8_extend_high_i8x16(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_extmul_low_u8x16(v128_t __a, v128_t __b) {
  return (v128_t)((__u16x8)wasm_u16x8_extend_low_u8x16(__a) *
                  (__u16x8)wasm_u16x8_extend_low_u8x16(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u16x8_extmul_high_u8x16(v128_t __a, v128_t __b) {
  return (v128_t)((__u16x8)wasm_u16x8_extend_high_u8x16(__a) *
                  (__u16x8)wasm_u16x8_extend_high_u8x16(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_extmul_low_i16x8(v128_t __a, v128_t __b) {
  return (v128_t)((__i32x4)wasm_i32x4_extend_low_i16x8(__a) *
                  (__i32x4)wasm_i32x4_extend_low_i16x8(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i32x4_extmul_high_i16x8(v128_t __a, v128_t __b) {
  return (v128_t)((__i32x4)wasm_i32x4_extend_high_i16x8(__a) *
                  (__i32x4)wasm_i32x4_extend_high_i16x8(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_extmul_low_u16x8(v128_t __a, v128_t __b) {
  return (v128_t)((__u32x4)wasm_u32x4_extend_low_u16x8(__a) *
                  (__u32x4)wasm_u32x4_extend_low_u16x8(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u32x4_extmul_high_u16x8(v128_t __a, v128_t __b) {
  return (v128_t)((__u32x4)wasm_u32x4_extend_high_u16x8(__a) *
                  (__u32x4)wasm_u32x4_extend_high_u16x8(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i64x2_extmul_low_i32x4(v128_t __a, v128_t __b) {
  return (v128_t)((__i64x2)wasm_i64x2_extend_low_i32x4(__a) *
                  (__i64x2)wasm_i64x2_extend_low_i32x4(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_i64x2_extmul_high_i32x4(v128_t __a, v128_t __b) {
  return (v128_t)((__i64x2)wasm_i64x2_extend_high_i32x4(__a) *
                  (__i64x2)wasm_i64x2_extend_high_i32x4(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u64x2_extmul_low_u32x4(v128_t __a, v128_t __b) {
  return (v128_t)((__u64x2)wasm_u64x2_extend_low_u32x4(__a) *
                  (__u64x2)wasm_u64x2_extend_low_u32x4(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS
wasm_u64x2_extmul_high_u32x4(v128_t __a, v128_t __b) {
  return (v128_t)((__u64x2)wasm_u64x2_extend_high_u32x4(__a) *
                  (__u64x2)wasm_u64x2_extend_high_u32x4(__b));
}

static __inline__ v128_t __DEFAULT_FN_ATTRS wasm_i16x8_q15mulr_sat(v128_t __a,
                                                                   v128_t __b) {
  return (v128_t)__builtin_wasm_q15mulr_sat_s_i16x8((__i16x8)__a, (__i16x8)__b);
}

// Old intrinsic names supported to ease transitioning to the standard names. Do
// not use these; they will be removed in the near future.

#define __DEPRECATED_FN_ATTRS(__replacement)                                   \\
  __DEFAULT_FN_ATTRS __attribute__(                                            \\
      (deprecated("use " __replacement " instead", __replacement)))

#define __WASM_STR(X) #X

#ifdef __DEPRECATED
#define __DEPRECATED_WASM_MACRO(__name, __replacement)                         \\
  _Pragma(__WASM_STR(GCC warning(                                              \\
      "'" __name "' is deprecated: use '" __replacement "' instead")))
#else
#define __DEPRECATED_WASM_MACRO(__name, __replacement)
#endif

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_v128_load8_splat")
wasm_v8x16_load_splat(const void *__mem) {
  return wasm_v128_load8_splat(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_v128_load16_splat")
wasm_v16x8_load_splat(const void *__mem) {
  return wasm_v128_load16_splat(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_v128_load32_splat")
wasm_v32x4_load_splat(const void *__mem) {
  return wasm_v128_load32_splat(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_v128_load64_splat")
wasm_v64x2_load_splat(const void *__mem) {
  return wasm_v128_load64_splat(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i16x8_load8x8")
wasm_i16x8_load_8x8(const void *__mem) {
  return wasm_i16x8_load8x8(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u16x8_load8x8")
wasm_u16x8_load_8x8(const void *__mem) {
  return wasm_u16x8_load8x8(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i32x4_load16x4")
wasm_i32x4_load_16x4(const void *__mem) {
  return wasm_i32x4_load16x4(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u32x4_load16x4")
wasm_u32x4_load_16x4(const void *__mem) {
  return wasm_u32x4_load16x4(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i64x2_load32x2")
wasm_i64x2_load_32x2(const void *__mem) {
  return wasm_i64x2_load32x2(__mem);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u64x2_load32x2")
wasm_u64x2_load_32x2(const void *__mem) {
  return wasm_u64x2_load32x2(__mem);
}

#define wasm_v8x16_shuffle(__a, __b, __c0, __c1, __c2, __c3, __c4, __c5, __c6, \\
                           __c7, __c8, __c9, __c10, __c11, __c12, __c13,       \\
                           __c14, __c15)                                       \\
  __DEPRECATED_WASM_MACRO("wasm_v8x16_shuffle", "wasm_i8x16_shuffle")          \\
  wasm_i8x16_shuffle(__a, __b, __c0, __c1, __c2, __c3, __c4, __c5, __c6, __c7, \\
                     __c8, __c9, __c10, __c11, __c12, __c13, __c14, __c15)

#define wasm_v16x8_shuffle(__a, __b, __c0, __c1, __c2, __c3, __c4, __c5, __c6, \\
                           __c7)                                               \\
  __DEPRECATED_WASM_MACRO("wasm_v16x8_shuffle", "wasm_i16x8_shuffle")          \\
  wasm_i16x8_shuffle(__a, __b, __c0, __c1, __c2, __c3, __c4, __c5, __c6, __c7)

#define wasm_v32x4_shuffle(__a, __b, __c0, __c1, __c2, __c3)                   \\
  __DEPRECATED_WASM_MACRO("wasm_v32x4_shuffle", "wasm_i32x4_shuffle")          \\
  wasm_i32x4_shuffle(__a, __b, __c0, __c1, __c2, __c3)

#define wasm_v64x2_shuffle(__a, __b, __c0, __c1)                               \\
  __DEPRECATED_WASM_MACRO("wasm_v64x2_shuffle", "wasm_i64x2_shuffle")          \\
  wasm_i64x2_shuffle(__a, __b, __c0, __c1)

// Relaxed SIMD intrinsics

#define __RELAXED_FN_ATTRS                                                     \\
  __attribute__((__always_inline__, __nodebug__, __target__("relaxed-simd"),   \\
                 __min_vector_width__(128)))

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_f32x4_relaxed_madd(v128_t __a, v128_t __b, v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_madd_f32x4((__f32x4)__a, (__f32x4)__b,
                                                   (__f32x4)__c);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_f32x4_relaxed_nmadd(v128_t __a, v128_t __b, v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_nmadd_f32x4((__f32x4)__a, (__f32x4)__b,
                                                    (__f32x4)__c);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_f64x2_relaxed_madd(v128_t __a, v128_t __b, v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_madd_f64x2((__f64x2)__a, (__f64x2)__b,
                                                   (__f64x2)__c);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_f64x2_relaxed_nmadd(v128_t __a, v128_t __b, v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_nmadd_f64x2((__f64x2)__a, (__f64x2)__b,
                                                    (__f64x2)__c);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i8x16_relaxed_laneselect(v128_t __a, v128_t __b, v128_t __m) {
  return (v128_t)__builtin_wasm_relaxed_laneselect_i8x16(
      (__i8x16)__a, (__i8x16)__b, (__i8x16)__m);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i16x8_relaxed_laneselect(v128_t __a, v128_t __b, v128_t __m) {
  return (v128_t)__builtin_wasm_relaxed_laneselect_i16x8(
      (__i16x8)__a, (__i16x8)__b, (__i16x8)__m);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i32x4_relaxed_laneselect(v128_t __a, v128_t __b, v128_t __m) {
  return (v128_t)__builtin_wasm_relaxed_laneselect_i32x4(
      (__i32x4)__a, (__i32x4)__b, (__i32x4)__m);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i64x2_relaxed_laneselect(v128_t __a, v128_t __b, v128_t __m) {
  return (v128_t)__builtin_wasm_relaxed_laneselect_i64x2(
      (__i64x2)__a, (__i64x2)__b, (__i64x2)__m);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i8x16_relaxed_swizzle(v128_t __a, v128_t __s) {
  return (v128_t)__builtin_wasm_relaxed_swizzle_i8x16((__i8x16)__a,
                                                      (__i8x16)__s);
}

static __inline__ v128_t __RELAXED_FN_ATTRS wasm_f32x4_relaxed_min(v128_t __a,
                                                                   v128_t __b) {
  return (v128_t)__builtin_wasm_relaxed_min_f32x4((__f32x4)__a, (__f32x4)__b);
}

static __inline__ v128_t __RELAXED_FN_ATTRS wasm_f32x4_relaxed_max(v128_t __a,
                                                                   v128_t __b) {
  return (v128_t)__builtin_wasm_relaxed_max_f32x4((__f32x4)__a, (__f32x4)__b);
}

static __inline__ v128_t __RELAXED_FN_ATTRS wasm_f64x2_relaxed_min(v128_t __a,
                                                                   v128_t __b) {
  return (v128_t)__builtin_wasm_relaxed_min_f64x2((__f64x2)__a, (__f64x2)__b);
}

static __inline__ v128_t __RELAXED_FN_ATTRS wasm_f64x2_relaxed_max(v128_t __a,
                                                                   v128_t __b) {
  return (v128_t)__builtin_wasm_relaxed_max_f64x2((__f64x2)__a, (__f64x2)__b);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i32x4_relaxed_trunc_f32x4(v128_t __a) {
  return (v128_t)__builtin_wasm_relaxed_trunc_s_i32x4_f32x4((__f32x4)__a);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_u32x4_relaxed_trunc_f32x4(v128_t __a) {
  return (v128_t)__builtin_wasm_relaxed_trunc_u_i32x4_f32x4((__f32x4)__a);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i32x4_relaxed_trunc_f64x2_zero(v128_t __a) {
  return (v128_t)__builtin_wasm_relaxed_trunc_s_zero_i32x4_f64x2((__f64x2)__a);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_u32x4_relaxed_trunc_f64x2_zero(v128_t __a) {
  return (v128_t)__builtin_wasm_relaxed_trunc_u_zero_i32x4_f64x2((__f64x2)__a);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i16x8_relaxed_q15mulr(v128_t __a, v128_t __b) {
  return (v128_t)__builtin_wasm_relaxed_q15mulr_s_i16x8((__i16x8)__a,
                                                        (__i16x8)__b);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i16x8_relaxed_dot_i8x16_i7x16(v128_t __a, v128_t __b) {
  return (v128_t)__builtin_wasm_relaxed_dot_i8x16_i7x16_s_i16x8((__i8x16)__a,
                                                                (__i8x16)__b);
}

static __inline__ v128_t __RELAXED_FN_ATTRS
wasm_i32x4_relaxed_dot_i8x16_i7x16_add(v128_t __a, v128_t __b, v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_dot_i8x16_i7x16_add_s_i32x4(
      (__i8x16)__a, (__i8x16)__b, (__i32x4)__c);
}

// FP16 intrinsics
#define __FP16_FN_ATTRS                                                        \\
  __attribute__((__always_inline__, __nodebug__, __target__("fp16"),           \\
                 __min_vector_width__(128)))

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_splat(float __a) {
  return (v128_t)__builtin_wasm_splat_f16x8(__a);
}

#ifdef __wasm_fp16__
// TODO Replace the following macros with regular C functions and use normal
// target-independent vector code like the other replace/extract instructions.

#define wasm_f16x8_extract_lane(__a, __i)                                      \\
  (__builtin_wasm_extract_lane_f16x8((__f16x8)(__a), __i))

#define wasm_f16x8_replace_lane(__a, __i, __b)                                 \\
  ((v128_t)__builtin_wasm_replace_lane_f16x8((__f16x8)(__a), __i, __b))

#endif

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_abs(v128_t __a) {
  return (v128_t)__builtin_wasm_abs_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_neg(v128_t __a) {
  return (v128_t)(-(__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_sqrt(v128_t __a) {
  return (v128_t)__builtin_wasm_sqrt_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_ceil(v128_t __a) {
  return (v128_t)__builtin_wasm_ceil_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_floor(v128_t __a) {
  return (v128_t)__builtin_wasm_floor_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_trunc(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_nearest(v128_t __a) {
  return (v128_t)__builtin_wasm_nearest_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_eq(v128_t __a, v128_t __b) {
  return (v128_t)((__f16x8)__a == (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_ne(v128_t __a, v128_t __b) {
  return (v128_t)((__f16x8)__a != (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_lt(v128_t __a, v128_t __b) {
  return (v128_t)((__f16x8)__a < (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_gt(v128_t __a, v128_t __b) {
  return (v128_t)((__f16x8)__a > (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_le(v128_t __a, v128_t __b) {
  return (v128_t)((__f16x8)__a <= (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_ge(v128_t __a, v128_t __b) {
  return (v128_t)((__f16x8)__a >= (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_add(v128_t __a,
                                                        v128_t __b) {
  return (v128_t)((__f16x8)__a + (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_sub(v128_t __a,
                                                        v128_t __b) {
  return (v128_t)((__f16x8)__a - (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_mul(v128_t __a,
                                                        v128_t __b) {
  return (v128_t)((__f16x8)__a * (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_div(v128_t __a,
                                                        v128_t __b) {
  return (v128_t)((__f16x8)__a / (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_min(v128_t __a,
                                                        v128_t __b) {
  return (v128_t)__builtin_wasm_min_f16x8((__f16x8)__a, (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_max(v128_t __a,
                                                        v128_t __b) {
  return (v128_t)__builtin_wasm_max_f16x8((__f16x8)__a, (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_pmin(v128_t __a,
                                                         v128_t __b) {
  return (v128_t)__builtin_wasm_pmin_f16x8((__f16x8)__a, (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_pmax(v128_t __a,
                                                         v128_t __b) {
  return (v128_t)__builtin_wasm_pmax_f16x8((__f16x8)__a, (__f16x8)__b);
}

static __inline__ v128_t __FP16_FN_ATTRS
wasm_i16x8_trunc_sat_f16x8(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_saturate_s_i16x8_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS
wasm_u16x8_trunc_sat_f16x8(v128_t __a) {
  return (v128_t)__builtin_wasm_trunc_saturate_u_i16x8_f16x8((__f16x8)__a);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_convert_i16x8(v128_t __a) {
  return (v128_t) __builtin_convertvector((__i16x8)__a, __f16x8);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_convert_u16x8(v128_t __a) {
  return (v128_t) __builtin_convertvector((__u16x8)__a, __f16x8);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_relaxed_madd(v128_t __a,
                                                                 v128_t __b,
                                                                 v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_madd_f16x8((__f16x8)__a, (__f16x8)__b,
                                                   (__f16x8)__c);
}

static __inline__ v128_t __FP16_FN_ATTRS wasm_f16x8_relaxed_nmadd(v128_t __a,
                                                                  v128_t __b,
                                                                  v128_t __c) {
  return (v128_t)__builtin_wasm_relaxed_nmadd_f16x8((__f16x8)__a, (__f16x8)__b,
                                                    (__f16x8)__c);
}

// Deprecated intrinsics

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i8x16_swizzle")
wasm_v8x16_swizzle(v128_t __a, v128_t __b) {
  return wasm_i8x16_swizzle(__a, __b);
}

static __inline__ bool __DEPRECATED_FN_ATTRS("wasm_v128_any_true")
wasm_i8x16_any_true(v128_t __a) {
  return wasm_v128_any_true(__a);
}

static __inline__ bool __DEPRECATED_FN_ATTRS("wasm_v128_any_true")
wasm_i16x8_any_true(v128_t __a) {
  return wasm_v128_any_true(__a);
}

static __inline__ bool __DEPRECATED_FN_ATTRS("wasm_v128_any_true")
wasm_i32x4_any_true(v128_t __a) {
  return wasm_v128_any_true(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i8x16_add_sat")
wasm_i8x16_add_saturate(v128_t __a, v128_t __b) {
  return wasm_i8x16_add_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u8x16_add_sat")
wasm_u8x16_add_saturate(v128_t __a, v128_t __b) {
  return wasm_u8x16_add_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i8x16_sub_sat")
wasm_i8x16_sub_saturate(v128_t __a, v128_t __b) {
  return wasm_i8x16_sub_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u8x16_sub_sat")
wasm_u8x16_sub_saturate(v128_t __a, v128_t __b) {
  return wasm_u8x16_sub_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i16x8_add_sat")
wasm_i16x8_add_saturate(v128_t __a, v128_t __b) {
  return wasm_i16x8_add_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u16x8_add_sat")
wasm_u16x8_add_saturate(v128_t __a, v128_t __b) {
  return wasm_u16x8_add_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i16x8_sub_sat")
wasm_i16x8_sub_saturate(v128_t __a, v128_t __b) {
  return wasm_i16x8_sub_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u16x8_sub_sat")
wasm_u16x8_sub_saturate(v128_t __a, v128_t __b) {
  return wasm_u16x8_sub_sat(__a, __b);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i16x8_extend_low_i8x16")
wasm_i16x8_widen_low_i8x16(v128_t __a) {
  return wasm_i16x8_extend_low_i8x16(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i16x8_extend_high_i8x16")
wasm_i16x8_widen_high_i8x16(v128_t __a) {
  return wasm_i16x8_extend_high_i8x16(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u16x8_extend_low_u8x16")
wasm_i16x8_widen_low_u8x16(v128_t __a) {
  return wasm_u16x8_extend_low_u8x16(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u16x8_extend_high_u8x16")
wasm_i16x8_widen_high_u8x16(v128_t __a) {
  return wasm_u16x8_extend_high_u8x16(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i32x4_extend_low_i16x8")
wasm_i32x4_widen_low_i16x8(v128_t __a) {
  return wasm_i32x4_extend_low_i16x8(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i32x4_extend_high_i16x8")
wasm_i32x4_widen_high_i16x8(v128_t __a) {
  return wasm_i32x4_extend_high_i16x8(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u32x4_extend_low_u16x8")
wasm_i32x4_widen_low_u16x8(v128_t __a) {
  return wasm_u32x4_extend_low_u16x8(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u32x4_extend_high_u16x8")
wasm_i32x4_widen_high_u16x8(v128_t __a) {
  return wasm_u32x4_extend_high_u16x8(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_i32x4_trunc_sat_f32x4")
wasm_i32x4_trunc_saturate_f32x4(v128_t __a) {
  return wasm_i32x4_trunc_sat_f32x4(__a);
}

static __inline__ v128_t __DEPRECATED_FN_ATTRS("wasm_u32x4_trunc_sat_f32x4")
wasm_u32x4_trunc_saturate_f32x4(v128_t __a) {
  return wasm_u32x4_trunc_sat_f32x4(__a);
}

// Undefine helper macros
#undef __DEFAULT_FN_ATTRS
#undef __DEPRECATED_FN_ATTRS

#endif // __WASM_SIMD128_H
`,"mm_malloc.h":`/*===---- mm_malloc.h - Allocating and Freeing Aligned Memory Blocks -------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __MM_MALLOC_H
#define __MM_MALLOC_H

#include <stdlib.h>

#ifdef _WIN32
#include <malloc.h>
#else
#ifndef __cplusplus
extern int posix_memalign(void **__memptr, size_t __alignment, size_t __size);
#else
// Some systems (e.g. those with GNU libc) declare posix_memalign with an
// exception specifier. Via an "egregious workaround" in
// Sema::CheckEquivalentExceptionSpec, Clang accepts the following as a valid
// redeclaration of glibc's declaration.
extern "C" int posix_memalign(void **__memptr, size_t __alignment, size_t __size);
#endif
#endif

#if !(defined(_WIN32) && defined(_mm_malloc))
static __inline__ void *__attribute__((__always_inline__, __nodebug__,
                                       __malloc__, __alloc_size__(1),
                                       __alloc_align__(2)))
_mm_malloc(size_t __size, size_t __align) {
  if (__align == 1) {
    return malloc(__size);
  }

  if (!(__align & (__align - 1)) && __align < sizeof(void *))
    __align = sizeof(void *);

  void *__mallocedMemory;
#if defined(__MINGW32__)
  __mallocedMemory = __mingw_aligned_malloc(__size, __align);
#elif defined(_WIN32)
  __mallocedMemory = _aligned_malloc(__size, __align);
#else
  if (posix_memalign(&__mallocedMemory, __align, __size))
    return 0;
#endif

  return __mallocedMemory;
}

static __inline__ void __attribute__((__always_inline__, __nodebug__))
_mm_free(void *__p)
{
#if defined(__MINGW32__)
  __mingw_aligned_free(__p);
#elif defined(_WIN32)
  _aligned_free(__p);
#else
  free(__p);
#endif
}
#endif

#endif /* __MM_MALLOC_H */
`}),Hn=`__wasm_idle_simd_target.h`;function Un(e){return`${e.replace(/\/+$/,``)}/include/wasm-idle/simd`}function Wn(e=``,t=!0){let n=Un(e);return[`-msimd128`,...Bn,`-include`,`${n}/${Hn}`,...t?[`-isystem`,n]:[]]}function Gn(e,t=``){let n=Un(t),r=n.split(`/`).filter(Boolean);for(let t=1;t<=r.length;t++)e.mkdirTree(`${n.startsWith(`/`)?`/`:``}${r.slice(0,t).join(`/`)}`);let i=new TextEncoder;e.mkdirTree(`${n}/emscripten`);for(let[t,r]of Object.entries(Vn)){let a=t===`xmmintrin.h`?`emscripten/${t}`:t;e.writeFile(`${n}/${a}`,i.encode(r))}e.writeFile(`${n}/xmmintrin.h`,i.encode(`#ifndef __wasm_idle_xmmintrin_h__
#define __wasm_idle_xmmintrin_h__
#include "emscripten/xmmintrin.h"
#undef _mm_malloc
#undef _mm_free
#include <mm_malloc.h>
#endif
`)),e.writeFile(`${n}/x86intrin.h`,i.encode(`#ifndef __wasm_idle_x86intrin_h__
#define __wasm_idle_x86intrin_h__
/* Wasm compatibility for SSE through AVX2; native x86-only intrinsics are excluded. */
#include <immintrin.h>
#endif
`)),e.writeFile(`${n}/${Hn}`,i.encode(`#ifndef __wasm_idle_simd_target_h__
#define __wasm_idle_simd_target_h__
#ifndef __wasm_simd128__
#undef __SSE__
#undef __SSE2__
#undef __SSE3__
#undef __SSSE3__
#undef __SSE4_1__
#undef __SSE4_2__
#undef __AVX__
#undef __AVX2__
#endif
#endif
`))}const Kn=`/usr/local/bin`,qn=`/usr/share/wasm-sysroot`,Jn=`/usr/share/wasm-sysroot-c`,Yn=`/opt/toolchains/llvm`;function Xn(e){let t=[];for(let n of[`include`,`lib`])e.some(e=>e.path===`${n}/wasm32-wasi`&&e.type===`directory`)&&!e.some(e=>e.path===`${n}/wasm32-wasip1`)&&t.push({path:`${n}/wasm32-wasip1`,type:`symlink`,mode:511,target:`wasm32-wasi`});let n=`lib/clang/22/lib/wasm32-unknown-wasip1`,r=`${n}/libclang_rt.builtins.a`;return!e.some(e=>e.path===r)&&e.some(e=>e.path===`lib/clang/22/lib/wasi/libclang_rt.builtins-wasm32.a`&&e.type===`file`)&&(e.some(e=>e.path===n)||t.push({path:n,type:`directory`,mode:493}),t.push({path:r,type:`symlink`,mode:511,target:`../wasi/libclang_rt.builtins-wasm32.a`})),t.length?[...e,...t]:e}const Zn=async e=>Array.from(new Uint8Array(await crypto.subtle.digest(`SHA-256`,Uint8Array.from(e))),e=>e.toString(16).padStart(2,`0`)).join(``),Qn=e=>{let t=new TextEncoder,n=[...e].sort(([e],[t])=>e<t?-1:+(e>t)).flatMap(([e,n])=>[t.encode(`${JSON.stringify([e,n.byteLength])}\n`),n]),r=new Uint8Array(n.reduce((e,t)=>e+t.byteLength,0)),i=0;for(let e of n)r.set(e,i),i+=e.byteLength;return r};function $n(e,t){for(let n of[e,t])if(!(n instanceof Uint8Array)||n.length<1024||n.length%512||n.subarray(-1024).some(e=>e!==0))throw Error(`Invalid sysroot layer terminator`);let n=e.length+t.length-1024;if(n>134217728)throw Error(`Composed sysroot exceeds its archive budget`);let r=new Uint8Array(n);return r.set(e.subarray(0,-1024)),r.set(t.subarray(0,-1024),e.length-1024),r}async function er({config:e,sdk:t,workspace:n,fetch:r,onRecord:i,onInvocation:a,adapters:o=[],commands:s={},workerGroup:c,shellCommands:l=[],shellRoutes:u={}}){let d=e.clangFilesystem===void 0?`snapshot`:e.clangFilesystem;if(d!==`snapshot`&&d!==`live`)throw TypeError(`clangFilesystem must be snapshot or live`);let f=d===`live`?`llvm-clang-tool-host-live-v1`:`llvm-clang-tool-host-v1`,p=e.sysrootLayers;if(e.sysrootProfile!==void 0&&![`full`,`c-base-v1`].includes(e.sysrootProfile)||!!p!=(e.sysrootProfile===`c-base-v1`))throw Error(`Explicit C base profile and pinned layers must be configured together`);if(p&&(p.schemaVersion!==1||p.basePackage!==`llvm-sysroot-c`||p.cxxPackage!==`llvm-sysroot-cxx`||!/^[a-f0-9]{64}$/.test(p.full?.sha256)||!Number.isSafeInteger(p.full?.bytes)||p.full.bytes<1024||p.full.bytes>134217728))throw Error(`Invalid pinned sysroot layer configuration`);let m=await Lt({bytes:new TextEncoder().encode(e.manifest),expectedSha256:e.manifestSha256,adapterIds:[`wasi-preview1-live`,f],allowedAssetURLs:e.assetURLs}),h=Object.freeze({enabled:!0,namespace:e.cacheNamespace,version:e.manifestSha256,storageReserveBytes:0}),g={distribution:m,fetch:r,persistentCache:h,maxCachedBytes:201326592},_=Gt({...g,capabilities:[`wasi-preview1`,`llvm-tool-host-exec-v1`]}),v=Ut({...g,maxCachedBytes:67108864}),y,b,x;try{y=c??ln({maxWorkers:e.maxWorkers??32}),x=(d===`live`?Rn:fn)({clangSha256:e.clangSha256,linkerSha256:e.linkerSha256,linkerPath:`${Yn}/bin/wasm-ld`,compilerPaths:[`${Yn}/bin/llvm`],...d===`live`?{moduleServices:e.clangModuleServices===!0}:{},executableOutputProfile:`wasi-preview1-process`,workerFactory:()=>new Worker(e.clangWorkerUrl,{type:`module`})}),b=te({workspace:n,packages:_,commands:s,maxBytes:n?.fs.maxBytes??268435456,adapters:[...o,zn({maxBlockedIoMs:12e4,workerFactory:()=>new Worker(e.liveWorkerUrl,{type:`module`})}),x],artifactAdapter:`wasi-preview1-live`,maxMemoryBytes:2**32,maxProcesses:8})}catch(e){throw x?.clearModuleCache?.(),await y?.dispose(),await _.dispose(),await v.dispose(),e}let S={...Object.fromEntries(l.map(e=>[`${Kn}/${e}`,{command:e}])),[`${Kn}/clang`]:{command:`clang`,args:Wn(qn),stdio:d===`live`?`delegated`:`forwarded`},[`${Kn}/wasm-run`]:{command:`wasm-run`},...u},C=/* @__PURE__ */ new Map,w=/* @__PURE__ */ new Map,T=(async()=>{let e=[];return Gn({mkdirTree(){},writeFile:(t,n)=>e.push([t,n])}),await Zn(Qn(e))})();T.catch(()=>{});let E,D,O,k=new AbortController,A=async(e,t)=>{if(e!==`c`&&e!==`full`)throw Error(`Unknown Clang sysroot profile`);let n=!p||e===`full`||C.has(`full`)?`full`:`c`,r=n===`c`?Jn:qn,i=[...n===`c`?[`--sysroot=${Jn}`,`-resource-dir=${Jn}/lib/clang/22`]:[],...Wn(r)];if(C.has(n))return i;let a=await Promise.allSettled([_.prepare(`llvm`,{signal:t}),p?_.prepare(p.basePackage,{signal:t}):void 0,p&&n===`full`?_.prepare(p.cxxPackage,{signal:t}):void 0]),o=a.find(e=>e.status===`rejected`);if(o)throw o.reason;let[s,c,l]=a.map(e=>e.status===`fulfilled`?e.value:void 0),u;if(p){if(u=c?.packages.find(e=>e.id===p.basePackage)?.files.find(e=>e.path===`sysroot.tar`)?.bytes,!u)throw Error(`Pinned LLVM profile has no base sysroot archive`);if(n===`full`){let e=l?.packages.find(e=>e.id===p.cxxPackage)?.files.find(e=>e.path===`sysroot.tar`)?.bytes;if(!e)throw Error(`Pinned LLVM profile has no C++ sysroot archive`);u=$n(u,e)}}else u=s?.packages.find(e=>e.id===`llvm`)?.files.find(e=>e.path===`sysroot.tar`)?.bytes;if(!u)throw Error(`Pinned LLVM profile has no sysroot archive`);let d=await Zn(u);if(t.throwIfAborted(),p&&n===`full`&&(u.length!==p.full.bytes||d!==p.full.sha256))throw Error(`Composed sysroot does not match its pinned identity`);let f=Rt(u),m={sha256:d,entries:f.length,files:f.filter(e=>e.type===`file`).length},h=await T;if(t.throwIfAborted(),!C.has(n)){let e=new Map(f.map(e=>[e.path,e]));Gn({mkdirTree(t){let n=``;for(let r of t.slice(1).split(`/`)){n=n?`${n}/${r}`:r;let t=e.get(n);if(t&&t.type!==`directory`)throw Error(`SIMD header directory conflicts with the pinned sysroot`);t||e.set(n,{path:n,type:`directory`,mode:365})}},writeFile(t,n){let r=t.slice(1);if(e.has(r))throw Error(`SIMD header conflicts with the pinned sysroot`);e.set(r,{path:r,type:`file`,mode:292,data:n})}}),b.fs.mountReadonly(r,Xn([...e.values()])),C.set(n,m),w.set(n,JSON.stringify([d,h]))}return i},j=async(e,t)=>{a?.(e),e.path===`/usr/local/bin/clang`&&await A(`full`,t)};return Object.freeze({container:b,manager:_,shellAssets:v,workers:y,cache:h,clangFilesystem:d,sysrootProfile:p?`c-base-v1`:`full`,inspectSysroot:(e=`full`)=>C.get(e)??null,toolchainIdentity:(t=`full`)=>{let n=w.get(t);return n?JSON.stringify([e.clangSha256,e.linkerSha256,n]):void 0},prepareCommand:j,prepareClang(e,t){return a?.({path:`${Kn}/clang`,argv:[`clang`],env:[],cwd:`/workspace`,stdin:null,stdout:null,stderr:null}),A(e,t)},startShell(n={},r){return D||k.signal.aborted?Promise.reject(/* @__PURE__ */ Error(`The dedicated Bash owner has already started or retired`)):(D=sn({container:b,sdk:t,workers:y,assets:v,sdkAsset:e.sdkAsset??{packageId:`shell`,assetId:`sdk`},shellAsset:e.shellAsset??{packageId:`shell`,assetId:`bash`},shellWasmSha256:e.bashWasmSha256,sdkUrl:e.sdkUrl,workerUrl:e.sdkWorkerUrl,memory:e.memory,routes:S,mounts:n.mounts,moduleDirectories:[`/workspace`],timeoutMs:e.commandTimeoutMs,args:n.args??[`--noprofile`,`--norc`],cwd:n.cwd??`/workspace`,env:{PATH:`${Kn}:/usr/bin:/bin`,HOME:`/workspace`,LANG:`C`,...n.env},signal:r?AbortSignal.any([r,k.signal]):k.signal,prepareCommand:j,onRecord:i}).then(e=>(E=e,e)),D)},dispose(){return O??=(async()=>{k.abort();let e=[];for(let t of[()=>y.dispose(),()=>E?.dispose(),()=>b.dispose(),()=>x?.clearModuleCache?.(),()=>_.dispose(),()=>v.dispose()])try{await t()}catch(t){e.push(t)}if(await D?.catch(()=>{}),e.length)throw AggregateError(e,`Bash profile cleanup failed`)})()}})}const tr=`wasm-idle-shell-control`,nr=`/usr/local/bin/${tr}`,rr=`/usr/share/wasm-idle-shell-control`,ir=`${rr}/rcfile`,ar=`/tmp/.wasm-idle-shell-control-request`,or=`/tmp/.wasm-idle-shell-inputrc`,sr=`website-shell-control-v1`,cr=2147483647,lr=new TextEncoder,ur=e=>new DOMException(e,`AbortError`),dr=e=>e.length<=4096&&e.startsWith(`/`)&&!e.includes(`\0`)&&(e===`/`||e.slice(1).split(`/`).every(e=>e&&e!==`.`&&e!==`..`));function fr(e,t){return[`# Trusted application rcfile. The mailbox is data and is never evaluated.`,`__wasm_idle_poll() {`,`  local __wic_version __wic_session __wic_generation __wic_language __wic_extra __wic_oldpwd __wic_fd`,`  local __wic_expected_session='${e}'`,`  [[ -f '${ar}' && -r '${ar}' ]] || return 0`,`  if builtin exec {__wic_fd}< '${ar}'; then :; else return 0; fi`,`  if IFS=' ' builtin read -r -n 160 -u "$__wic_fd" __wic_version __wic_session __wic_generation __wic_language __wic_extra; then`,`    builtin exec {__wic_fd}<&-`,`  else`,`    builtin exec {__wic_fd}<&-`,`    return 0`,`  fi`,`  [[ "$__wic_session" == "$__wic_expected_session" && -z "$__wic_extra" ]] || return 0`,`  [[ "$__wic_generation" =~ ^[1-9][0-9]{0,9}$ ]] || return 0`,`  (( __wic_generation <= ${cr} && __wic_generation > \${__wasm_idle_control_generation:-0} )) || return 0`,`  if [[ "$__wic_version" == 2 ]]; then`,`    case "$__wic_language" in suspend|resume) ;; *) return 0 ;; esac`,`    __wasm_idle_control_generation=$__wic_generation`,`    builtin printf "\\r\\n"`,`    if '${nr}' 2 "$__wic_session" "$__wic_generation" "$__wic_language" ok; then :; else :; fi`,`    [[ "$__wic_language" == resume ]] && return 124`,`    return 0`,`  fi`,`  [[ "$__wic_version" == 1 ]] || return 0`,`  case "$__wic_language" in ${t.join(`|`)}) ;; *) return 0 ;; esac`,`  __wasm_idle_control_generation=$__wic_generation`,`  __wic_oldpwd=$PWD`,`  if builtin cd -P -- "/workspace/$__wic_language"; then`,`    if '${nr}' 1 "$__wic_session" "$__wic_generation" "$__wic_language" ok; then :; else :; fi`,`    if [[ "$__wic_oldpwd" != "$PWD" ]]; then`,`      builtin printf "\\r\\n"`,`      return 124`,`    fi`,`  else`,`    if '${nr}' 1 "$__wic_session" "$__wic_generation" "$__wic_language" failed; then :; else :; fi`,`  fi`,`  return 0`,`}`,`readonly -f __wasm_idle_poll`,``].join(`
`)}function pr(e){let t=[...new Set(e.languages)].sort();if(!t.length||t.some(e=>!/^[A-Z][A-Z0-9_]{0,63}$/.test(e)))throw Error(`Shell control requires a fixed language allowlist`);let n=new Set(t),r=e.session??Array.from(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)),e=>e.toString(16).padStart(2,`0`)).join(``);if(!/^[a-f0-9]{32}$/.test(r))throw Error(`Invalid shell control session`);let i=e.initialDirectory??`/workspace`;if(i!==`/workspace`&&!t.some(e=>i===`/workspace/${e}`))throw Error(`Invalid initial shell directory`);let a,o=!1,s=0,c=0,l,u=null,d,f=()=>Object.freeze({ready:!!a,disposed:o,cwd:i,pendingCwd:l?.cwd??null,generation:s,appliedGeneration:c,error:u}),p=()=>{try{e.onChange?.(f())}catch{}},m=()=>{if(o)throw Error(`Shell directory control has been disposed`);if(!a)throw Error(`Shell directory control has not been set up`);return a},h=(e,t)=>{if(e.lstat(`/workspace`).type!==`directory`||e.realpath(`/workspace`)!==`/workspace`)throw Error(`Workspace root is not a directory`);try{if(e.lstat(t).type!==`directory`||e.realpath(t)!==t)throw Error(`Shell directory must be an actual project directory`)}catch(n){if(n.code!==`ENOENT`)throw n;e.mkdir(t)}},g=(e,t)=>{if(e.lstat(`/tmp`).type!==`directory`||e.realpath(`/tmp`)!==`/tmp`)throw Error(`Shell control needs the private temporary mount`);try{if(e.lstat(`/tmp/.wasm-idle-shell-control-request`).type!==`file`)throw Error(`Shell control mailbox must be a regular file`)}catch(e){if(e.code!==`ENOENT`)throw e}e.writeFile(ar,lr.encode(t),{mode:384})},_=(e,t)=>{if(o||!a||e.length!==5||![`1`,`2`].includes(e[0])||e[1]!==r||!/^[1-9][0-9]{0,9}$/.test(e[2])||!(e[0]===`1`?n.has(e[3]):[`suspend`,`resume`].includes(e[3]))||![`ok`,`failed`].includes(e[4])||!dr(t))return 126;let f=e[0],m=Number(e[2]),h=e[3],g=e[4];if(f===`1`&&g===`ok`&&t!==`/workspace/${h}`||m>cr||m>s)return 126;if(m<s)return 0;if(!l)return d?.version===f&&d.generation===m&&d.target===h&&d.cwd===t&&d.verdict===g?0:126;if(l.version!==f||l.target!==h||l.cwd&&g===`ok`&&t!==l.cwd)return 126;let _=l;return l=void 0,_.removeAbort?.(),i=t,d={version:f,generation:m,target:h,cwd:t,verdict:g},g===`ok`?(c=m,u=null,_.resolve()):(u=`Bash could not enter ${_.cwd}`,_.reject(Error(u))),p(),0},v=(e,t,i)=>{try{let a=m();if(i?.throwIfAborted(),e===`1`?!n.has(t):![`suspend`,`resume`].includes(t))throw Error(`Unknown shell control target`);if(l?.version===e&&l.target===t)return l.promise;if(s===cr)throw Error(`Shell control generation exhausted`);let o=e===`1`?`/workspace/${t}`:void 0,c=s+1;o&&h(a,o),g(a,`${e} ${r} ${c} ${t}\n`),l?.removeAbort?.(),l?.reject(ur(`Shell control request was superseded`));let d,f,_=new Promise((e,t)=>{d=e,f=t}),v={version:e,target:t,cwd:o,promise:_,resolve:d,reject:f};if(l=v,s=c,u=null,i){let e=()=>{if(l===v){l=void 0,v.removeAbort?.();try{g(a,`1 ${r} 0 -\n`)}catch{}f(i.reason??ur(`Shell control request was cancelled`)),p()}};i.addEventListener(`abort`,e,{once:!0}),v.removeAbort=()=>i.removeEventListener(`abort`,e)}return p(),_}catch(e){return Promise.reject(e)}},y={id:sr,filesystem:`live`,async start(e){if(e.fs!==m()||e.invocation.command!==`wasm-idle-shell-control`)throw Error(`Shell control command belongs to a different container`);let t=()=>new ReadableStream({start(e){e.close()}});return{stdin:new WritableStream({write(e){if(e.length)throw Error(`Shell control does not consume program input`)}}),stdout:t(),stderr:t(),async run(){return{code:e.signal.aborted?143:_(e.invocation.args,e.invocation.cwd)}},async dispose(){}}}},b=Object.freeze({[tr]:Object.freeze({adapter:sr,bytes:/* @__PURE__ */ new Uint8Array,argv0:tr})}),x=Object.freeze({mountPath:rr,rcfilePath:ir,requestPath:ar,args:Object.freeze([`--noprofile`,`--norc`,`-i`]),env:Object.freeze({WASM_IDLE_SHELL_CONTROL:`1`,INPUTRC:or,"BASH_FUNC___wasm_idle_poll%%":`() ${fr(r,t).match(/__wasm_idle_poll\(\) (\{[\s\S]*?\n\})/)[1]}`})});return Object.freeze({adapter:y,commands:b,route:Object.freeze({path:nr,command:tr}),setup(e){if(o)throw Error(`Shell directory control has been disposed`);if(a){if(a!==e)throw Error(`Shell control cannot share containers`);return x}return h(e,i),g(e,`1 ${r} 0 -\n`),e.writeFile(or,lr.encode(`set input-meta on
set convert-meta off
set output-meta on
`),{mode:384}),e.mountReadonly(rr,[{path:`rcfile`,type:`file`,mode:292,data:lr.encode(fr(r,t))}]),a=e,p(),x},requestDirectory(e){return n.has(e)?v(`1`,e):Promise.reject(/* @__PURE__ */ Error(`Unknown shell project directory`))},requestPrompt(e,t){return v(`2`,e,t)},onInvocation(e){return e.path===nr?_(e.argv.slice(1),e.cwd):void 0},inspect:f,dispose(){if(!o){if(o=!0,l?.removeAbort?.(),l?.reject(ur(`Shell directory control was disposed`)),l=void 0,a)try{a.lstat(`/tmp/.wasm-idle-shell-control-request`).type===`file`&&new TextDecoder().decode(a.readFile(`/tmp/.wasm-idle-shell-control-request`)).startsWith(`1 ${r} `)&&a.unlink(ar)}catch{}p()}}})}const mr=`website-playground-engine`,hr=`website-playground-host-v1`,gr=new TextEncoder,_r=new TextDecoder,vr=e=>({C:`main.c`,CPP:`main.cpp`,PYTHON:`main.py`,PYTHON3:`main.py`,JAVA:`Main.java`,RUST:`main.rs`,GO:`main.go`,JAVASCRIPT:`main.js`,TYPESCRIPT:`main.ts`})[e]??`main.txt`;var yr=class{settings;adapter;commands={[mr]:{adapter:hr,bytes:/* @__PURE__ */ new Uint8Array,argv0:mr}};filesystemProfile=`shared-source-snapshot; runtime-private-files-not-exported`;#e;#t=/* @__PURE__ */ new Map;#n=/* @__PURE__ */ new Map;#r=/* @__PURE__ */ new Map;#i=/* @__PURE__ */ new Map;#a=0;#o=!1;constructor(e){this.settings=e,this.adapter={id:hr,filesystem:`live`,start:async e=>{let t=this.#n.get(e.invocation.args[0]);if(!t||e.invocation.args.length!==1||e.fs!==this.fs||e.invocation.cwd!==this.directory(t.language))throw new g(`INVALID_ARGUMENT`,`Unknown application runtime job`);let n,r,i=!1,a=0,o=new ReadableStream({start(e){n=e}}),s=new ReadableStream({start(e){r=e}}),c=this.session(t.language);t.output=r=>{if(i||e.signal.aborted)return;let o=gr.encode(r);if(a+=o.byteLength,a>e.limits.maxOutputBytes){t.error=new g(`RESOURCE_LIMIT`,`Runtime output exceeds the container limit`),t.controller.abort(t.error);return}o.byteLength&&n.enqueue(o)};let l=()=>{c.loaded=!1,c.sandbox.then(e=>e.terminate()).catch(()=>{})};return e.signal.addEventListener(`abort`,l,{once:!0}),{stdin:new WritableStream({write:e=>this.write(t.language,_r.decode(e,{stream:!0})),close:()=>t.method===`run`?this.eof(t.language):void 0}),stdout:o,stderr:s,run:async()=>{try{await t.warm?.catch(()=>{});let n=await c.sandbox;e.signal.throwIfAborted();let r={...t.options,signal:e.signal};if(t.method===`load`)await n.load(t.code,t.log,t.args,r,t.progress),c.loaded=!0,t.result=!0;else{let e=n.run(t.code,t.method===`prepare`,t.log,t.progress,t.args,r);t.method===`run`&&(t.readyForInput=!0,await this.flushInput(c,n)),t.result=await e}if(t.error)throw t.error;return{code:+(t.result===!1)}}catch(e){throw t.error=e,e}},dispose:async()=>{i||(i=!0,e.signal.removeEventListener(`abort`,l),t.readyForInput=!1,e.signal.aborted&&(c.loaded=!1,await c.sandbox.then(e=>e.terminate()).catch(()=>{})),n.close(),r.close())}}}}}attach(e){if(this.#e)throw Error(`Runtime adapter is already attached`);this.#e=e}get fs(){if(!this.#e)throw Error(`Container not attached`);return this.#e.fs}directoryPath(e){if(typeof e!=`string`||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(e)||!Ye(e))throw TypeError(`Unsupported workspace language`);return`/workspace/${e}`}directory(e){let t=this.directoryPath(e);return this.fs.mkdir(t,{recursive:!0}),t}session(e){if(this.#o)throw Error(`Runtime owner disposed`);let t=this.#t.get(e);if(t)return t;let n=this.settings.createBinding(this.settings.runtimeAssets);t={binding:n,sandbox:void 0,pendingInput:[],pendingBytes:0,pendingEof:!1};let r=t;return t.sandbox=n.load(e).then(t=>{let n=t;n.output=e=>r.active?.output?.(e);for(let[t,i]of[[`ondebug`,`debug`],[`oncompilerdiagnostic`,`diagnostic`],[`image`,`image`]])n[t]=t=>this.settings.emit({language:e,name:i,data:t,requestId:r.active?.requestId});return n}),t.sandbox.catch(()=>{}),this.#t.set(e,t),t}syncWorkspace(e,n,r,i){let a=this.directoryPath(e),o=t(n,{maxFiles:2048,maxFileBytes:16777216,maxTotalBytes:67108864,caseSensitive:!0}),s=new Set(o.map(e=>e.path)),c=s;if(i!==void 0){if(r===void 0||!Array.isArray(i)||i.length>2048)throw TypeError(`Invalid workspace delta metadata`);let e=t(i.map(e=>({path:e.path,content:``})),{maxFiles:2048,caseSensitive:!0}),n=/* @__PURE__ */ new Map,a=0;for(let t=0;t<e.length;t++){let r=i[t].bytes;if(!Number.isSafeInteger(r)||r<0||r>16777216)throw TypeError(`Invalid workspace file size`);a+=r,n.set(e[t].path,r)}if(a>67108864)throw TypeError(`Workspace exceeds total size limit`);for(let e of o){let t=typeof e.content==`string`?gr.encode(e.content).length:e.content.length;if(n.get(e.path)!==t)throw TypeError(`Workspace delta size mismatch`)}c=new Set(n.keys())}let l=e=>typeof e==`string`?gr.encode(e):e,u=(e,t)=>e===void 0||t===void 0?e===t:e.length===t.length&&e.every((e,n)=>e===t[n]),d=e=>{try{return this.fs.readFile(e,{root:a,cwd:a})}catch(e){if(e.code!==`ENOENT`)throw e;return}},f=r===void 0?void 0:new Map(t(r,{maxFiles:2048,maxFileBytes:16777216,maxTotalBytes:67108864,caseSensitive:!0}).map(e=>[e.path,l(e.content)])),p=[...f?.keys()??this.#r.get(e)??[]].filter(e=>!s.has(e));if(i&&p.some(e=>c.has(e)))throw TypeError(`Deleted workspace file remains in project metadata`);if(f){for(let e of o){let t=f.get(e.path),n=l(e.content);if(u(t,n))continue;let r=d(e.path);if(!u(r,t)&&!u(r,n))throw new g(`FILESYSTEM_CONFLICT`,`Workspace changed while editing ${e.path}`)}for(let e of p)if(d(e)!==void 0&&!u(d(e),f.get(e)))throw new g(`FILESYSTEM_CONFLICT`,`Workspace changed before deleting ${e}`)}this.fs.applyFileChanges({remove:p,write:o.filter(e=>!f?.has(e.path)||!u(f.get(e.path),l(e.content))).map(e=>({path:e.path,bytes:l(e.content)}))},{root:a,cwd:a,createRoot:!0}),this.#r.set(e,c)}readWorkspaceDelta(e,t){let n=this.directory(e),r=this.#i.get(e),i=!r||t!==r.revision,a=/* @__PURE__ */ new Map,o=[],s=e=>{for(let t of this.fs.readdir(e||`.`,{root:n,cwd:n})){let c=e?`${e}/${t}`:t,l={root:n,cwd:n},u=this.fs.lstat(c,l);if(u.type===`directory`)s(c);else if(u.type===`file`){let e=this.fs.captureFileVersion(c,l);a.set(c,e),(i||r?.versions.get(c)!==e)&&o.push({path:c,content:this.fs.readFile(c,l)})}}};s(``);let c=i?[]:[...r.versions.keys()].filter(e=>!a.has(e)),l=(r?.revision??0)+1;return this.#i.set(e,{revision:l,versions:a}),{revision:l,reset:i,files:o,deleted:c}}readWorkspace(e){let t=this.directory(e),n=[],r=e=>{for(let i of this.fs.readdir(e||`.`,{root:t,cwd:t})){let a=e?`${e}/${i}`:i,o=this.fs.lstat(a,{root:t,cwd:t});o.type===`directory`?r(a):o.type===`file`&&n.push({path:a,content:this.fs.readFile(a,{root:t,cwd:t})})}};return r(``),n}listWorkspaceFiles(){let e=[],t={root:`/workspace`,cwd:`/workspace`},n=r=>{for(let i of this.fs.readdir(r||`.`,t)){let a=r?`${r}/${i}`:i,o=this.fs.lstat(a,t);(o.type===`file`||o.type===`directory`||o.type===`symlink`)&&(e.push({path:a,type:o.type,size:o.size}),o.type===`directory`&&n(a))}};return n(``),e}inputs(e,t,n){let r=this.directory(e),i=l(n.activePath??vr(e));try{this.fs.stat(i,{root:r,cwd:r})}catch(r){if(r.code!==`ENOENT`)throw r;this.syncWorkspace(e,[...new Map([...n.workspaceFiles??[],{path:i,content:t}].map(e=>[e.path,e])).values()])}let a=this.readWorkspace(e);return{code:new TextDecoder(`utf-8`,{fatal:!0}).decode(this.fs.readFile(i,{root:r,cwd:r})),options:{...n,activePath:i,workspaceFiles:a}}}async execute(e,t,n=``,r=!0,i=[],a={},o,s,c=0){o.throwIfAborted();let l=this.session(t);if(l.active)throw new g(`RESOURCE_LIMIT`,`${t} already has an active runtime job`);let u=this.inputs(t,n,a),d=new AbortController;o=AbortSignal.any([o,d.signal]);let f,p=new Promise(e=>{f=e}),m=l.warm;m&&(m.claimed=!0);let h={id:String(++this.#a),language:t,method:e,code:u.code,log:r,args:[...i],options:u.options,signal:o,controller:d,finished:p,warm:m?.promise,progress:s,requestId:c};l.active=h,this.#n.set(h.id,h);try{let n=await this.#e.spawn(mr,[h.id],{cwd:this.directory(t),env:a.env,signal:o});h.process=n,o.aborted&&(await n.terminate(),o.throwIfAborted());let r=async e=>{let n=e.getReader(),r=new TextDecoder;try{for(;;){let{value:e,done:i}=await n.read();if(i)break;let a=r.decode(e,{stream:!0});a&&this.settings.emit({language:t,name:`output`,data:a,requestId:c})}let e=r.decode();e&&this.settings.emit({language:t,name:`output`,data:e,requestId:c})}finally{n.releaseLock()}},[i]=await Promise.all([n.exited,r(n.stdout),r(n.stderr)]);if(o.aborted)throw o.reason??new DOMException(`Runtime cancelled`,`AbortError`);if(h.error)throw h.error;if(i.reason!==`exited`)throw Error(`Runtime ended with ${i.reason}`);return e===`load`?void 0:h.result??i.code===0}catch(e){throw o.throwIfAborted(),e}finally{l.active===h&&(l.active=void 0),this.#n.delete(h.id),f()}}async prewarm(e,t){t.throwIfAborted();let n=this.session(e);if(n.active)return!1;if(n.loaded)return!0;let r=n.warm??=this.warm(e,n),i=()=>{r.claimed||r.controller.abort(t.reason)};t.addEventListener(`abort`,i,{once:!0});try{return await r.promise,!t.aborted}catch{return!1}finally{t.removeEventListener(`abort`,i)}}warm(e,t){let n=new AbortController,r={controller:n,claimed:!1,promise:(async()=>{let e=await t.sandbox;n.signal.throwIfAborted(),await e.load(``,!1,[],{signal:n.signal}),n.signal.throwIfAborted(),t.loaded=!0})()};return r.promise.then(()=>{t.warm===r&&(t.warm=void 0)},async()=>{t.warm===r&&(t.warm=void 0),!(r.claimed||t.active||this.#t.get(e)!==t)&&(this.#t.delete(e),await t.binding.dispose?.())}).catch(()=>{}),r}async flushInput(e,t){if(e.active?.readyForInput){for(let n of e.pendingInput.splice(0))t.write?.(n);e.pendingBytes=0,e.pendingEof&&(e.pendingEof=!1,t.eof())}}async write(e,t){if(typeof t!=`string`)throw TypeError(`Runtime input must be text`);let n=this.session(e);if(n.pendingEof)throw Error(`Runtime input is closed`);let r=gr.encode(t).byteLength;if(n.pendingBytes+r>8388608)throw Error(`Pending runtime input exceeds the container limit`);n.pendingInput.push(t),n.pendingBytes+=r,n.active?.readyForInput&&await this.flushInput(n,await n.sandbox)}async eof(e){let t=this.session(e);t.pendingEof=!0,t.active?.readyForInput&&await this.flushInput(t,await t.sandbox)}async stop(e){let t=this.#t.get(e);if(!t)return;t.pendingInput.length=0,t.pendingBytes=0,t.pendingEof=!1;let n=t.active;if(n){n.controller.abort(new DOMException(`Runtime cancelled`,`AbortError`)),await n.finished;return}t.warm&&!t.warm.claimed&&t.warm.controller.abort(new DOMException(`Runtime cancelled`,`AbortError`)),t.loaded=!1,await t.sandbox.then(n=>{if(this.#t.get(e)===t&&!t.active)return n.terminate()}).catch(()=>{})}async clear(e){await(await this.session(e).sandbox).clear()}async restart(e){await this.stop(e);let t=this.#t.get(e);this.#t.delete(e),await t?.binding.dispose?.()}async debug(e,t,n){if(!(/* @__PURE__ */ new Set([`debugCommand`,`debugPause`,`setBreakpoints`,`setSourceBreakpoints`,`debugEvaluate`,`debugEvaluateValue`,`debugSetSteppingOptions`,`debugVariables`,`debugScopes`,`debugFrameScopes`,`debugFrameName`,`debugReadMemory`,`debugWriteMemory`,`debugDataBreakpointInfo`,`debugSetDataBreakpoints`])).has(t))throw TypeError(`Unknown debugger method`);let r=t===`setSourceBreakpoints`?yt(n[0]):void 0,i=r?n[1]:void 0;if(i!==void 0&&typeof i!=`string`)throw TypeError(`Invalid debugger source path`);let a=await this.session(e).sandbox,o=a[t];if(r&&typeof o!=`function`&&typeof a.setBreakpoints==`function`)return bt(r,{}),await a.setBreakpoints(r.filter(e=>e.enabled!==!1).map(e=>e.line),i);if(typeof o!=`function`)throw Error(`The ${e} runtime does not support ${t}`);return await o.apply(a,r?[r,i]:n)}inspect(){return[...this.#n.values()].map(e=>({language:e.language,pid:e.process?.pid,phase:e.method,filesystem:this.filesystemProfile}))}async dispose(){this.#o||(this.#o=!0,await Promise.allSettled([...this.#t].map(async([e,t])=>{let n=t.active?this.stop(e):Promise.resolve();await Promise.all([n,t.binding.dispose?.()])})),this.#t.clear(),this.#n.clear(),this.#i.clear())}};function br(e){return Array.isArray(e)?[...e]:[]}const xr=/* @__PURE__ */ new Set([`C`,`CPP`,`OBJC`,`OBJECTIVECXX`]);function Sr(e,t=[],n={}){return xr.has(e)?{compileArgs:br(n.compileArgs??t),programArgs:br(n.programArgs)}:{compileArgs:br(n.compileArgs),programArgs:br(n.programArgs??t)}}function Cr(e){return(e||``).trim().toUpperCase().replaceAll(/\s+/g,``)}function wr(e){switch(Cr(e)){case`98`:case`CPP98`:case`C++98`:case`GNU++98`:case`GNUC++98`:return`-std=gnu++98`;case`03`:case`CPP03`:case`C++03`:case`GNU++03`:case`GNUC++03`:return`-std=gnu++03`;case`11`:case`CPP11`:case`C++11`:case`GNU++11`:case`GNUC++11`:return`-std=gnu++11`;case`14`:case`CPP14`:case`C++14`:case`GNU++14`:case`GNUC++14`:return`-std=gnu++14`;case`17`:case`CPP17`:case`C++17`:case`GNU++17`:case`GNUC++17`:return`-std=gnu++17`;case`20`:case`CPP20`:case`C++20`:case`GNU++20`:case`GNUC++20`:return`-std=gnu++20`;case`23`:case`CPP23`:case`C++23`:case`GNU++23`:case`GNUC++23`:return`-std=gnu++23`;case`26`:case`CPP26`:case`C++26`:case`GNU++26`:case`GNUC++26`:return`-std=gnu++26`;default:return`-std=gnu++20`}}function Tr(e){switch(Cr(e)){case`89`:case`90`:case`C89`:case`C90`:case`GNU89`:case`GNU90`:case`GNUC89`:case`GNUC90`:return`-std=gnu89`;case`99`:case`C99`:case`GNU99`:case`GNUC99`:return`-std=gnu99`;case`11`:case`C11`:case`GNU11`:case`GNUC11`:return`-std=gnu11`;case`17`:case`18`:case`C17`:case`C18`:case`GNU17`:case`GNU18`:case`GNUC17`:case`GNUC18`:return`-std=gnu17`;case`23`:case`2X`:case`C23`:case`C2X`:case`GNU23`:case`GNU2X`:case`GNUC23`:case`GNUC2X`:return`-std=gnu23`;case`2Y`:case`C2Y`:case`GNU2Y`:case`GNUC2Y`:return`-std=gnu2y`;default:return`-std=gnu11`}}function Er(e,t){return e===`C`?{languageArg:`c`,standardArg:Tr(t.cVersion)}:e===`OBJC`?{languageArg:`objective-c`,standardArg:Tr(t.cVersion)}:{languageArg:`c++`,standardArg:wr(t.cppVersion)}}const Dr=/precompiled (header|file)|PCH file|AST file/i,Or=33554432;var kr=class{profile;files;emit;#e=/* @__PURE__ */ new Map;#t=/* @__PURE__ */ new Map;#n;#r=/* @__PURE__ */ new Map;#i=/* @__PURE__ */ new Map;#a;#o;#s;#c;#l=!1;constructor(e,t,n,r={}){this.profile=e,this.files=t,this.emit=n,this.#c=r.headerCache}get headerCache(){return this.#c??=he(V())}queue(e){let t=this.#i.get(e);return t||this.#i.set(e,t={chunks:[],size:0,eof:!1}),t}key(e,t,n,r){return JSON.stringify([e,t,Sr(e,n,r).compileArgs,r.cppVersion,r.cVersion,r.activePath,r.env])}artifact(e){let t=this.profile.container.fs;if(this.#n)try{let n=t.lstat(this.#n.path);if(n.type===`directory`&&n.inode===this.#n.inode)return`${this.#n.path}/${e}.wasm`}catch{}for(let n=0;n<8;n++){let n=`/workspace/.wasm-idle-run-${crypto.randomUUID()}`;try{t.mkdir(n)}catch(e){if(e.code===`EEXIST`)continue;throw e}return this.#n={path:n,inode:t.lstat(n).inode},`${n}/${e}.wasm`}throw Error(`Could not allocate a private compiler output directory`)}currentProgram(e,t,n){let r=this.profile.container.fs;if(e&&e.key===t&&e.generation===r.generation)try{if(r.captureFileVersion(n)===e.version&&r.stat(n).mode&73)return e}catch{}}async spawn(e,t,n,r){e.signal.throwIfAborted();let i=await this.profile.container.spawn(t,n,{...r,signal:e.signal});return e.process=i,e.signal.aborted&&(await i.terminate().catch(()=>{}),e.signal.throwIfAborted()),i}async drain(e,t,n,r=!1,i=!1,a=this.emit){let o=async(e,o)=>{let s=e.getReader(),c=new TextDecoder,l=``;try{for(;;){let{value:e,done:u}=await s.read(),d=u?c.decode():c.decode(e,{stream:!0});if(d&&!i&&a({language:t,name:`output`,data:d,requestId:n}),o&&r){l+=d;let e=l.split(`
`);l=e.pop()??``;for(let r of e){let e=r.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,``),i=/^(.*?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/.exec(e);i&&a({language:t,name:`diagnostic`,requestId:n,data:{fileName:i[1].replace(`/workspace/${t}/`,`/workspace/`),lineNumber:Number(i[2]),columnNumber:Number(i[3]),severity:i[4].includes(`error`)?`error`:i[4]===`warning`?`warning`:`other`,message:i[5]}})}l.length>65536&&(l=``)}if(u)break}}finally{s.releaseLock()}},[s]=await Promise.all([e.exited,o(e.stdout,!1),o(e.stderr,!0)]);return s}success(e,t){if(t.aborted)throw t.reason??new DOMException(`Command cancelled`,`AbortError`);if(e.reason!==`exited`)throw Error(`Container command ended with ${e.reason}`);return e.code===0}headerKey(e,t,n,r,i,a){if(e!==`CPP`||n.length||Object.keys(r.env??{}).length||r.workspaceFiles?.some(e=>e.path!==r.activePath&&!/\.(?:c|cc|cpp|cxx|wasm)$/i.test(e.path)))return;let o=t.replace(/^\uFEFF/,``);for(;;)if(o=o.replace(/^\s+/,``),o.startsWith(`//`)){let e=o.indexOf(`
`);if(e<0||o.slice(0,e).trimEnd().endsWith(`\\`))return;o=o.slice(e+1)}else if(o.startsWith(`/*`)){let e=o.indexOf(`*/`,2);if(e<0)return;o=o.slice(e+2)}else break;if(/^#[ \t]*include[ \t]*<bits\/stdc\+\+\.h>/.test(o))return JSON.stringify([i,a,`-fno-exceptions`])}discardHeader(e){if(this.#a){try{this.profile.container.fs.withMutationSource(e,()=>this.profile.container.fs.unlink(this.#a.path))}catch{}this.#a=void 0}}async prewarm(e,t){return this.#l||e!==`C`&&e!==`CPP`?!1:(t.throwIfAborted(),this.profile.prepareClang?await this.profile.prepareClang(e===`C`&&this.profile.sysrootProfile===`c-base-v1`?`c`:`full`,t):await this.profile.prepareCommand({path:`/usr/local/bin/clang`,argv:[`clang`],env:[],cwd:`/workspace`,stdin:null,stdout:null,stderr:null},t),!t.aborted)}async prepare(e,t,n,r,i,a,o){if(this.#l)throw Error(`Clang runtime has been disposed`);if(this.#e.has(e))throw Error(`${e} already has an active command`);let s=new AbortController;i=AbortSignal.any([i,s.signal]);let c={language:e,phase:`prepare`,controller:s,signal:i},l;this.#e.set(e,c);let u=this.#t.get(e);this.#t.delete(e);try{i.throwIfAborted();let s=this.files.inputs(e,t,r),d=this.files.directory(e),f=this.artifact(e),p=this.key(e,s.code,n,s.options),m=this.currentProgram(u,p,f);if(m?.reusable){a?.report?.({kind:`activity`,phase:`starting`,label:`Reusing the compiled program`});let t=()=>(i.throwIfAborted(),this.currentProgram(m,p,f)),n=[...m.diagnostics.filter(e=>e.name!==`diagnostic`),...m.diagnostics.filter(e=>e.name===`diagnostic`)];for(let e of n){if(!t())break;this.emit({...structuredClone(e),requestId:o})}if(t())return this.#t.set(e,m),!0}a?.report?.({kind:`activity`,phase:`initializing`,label:`Preparing the Clang toolchain`});let{compileArgs:h}=Sr(e,n,r),g=this.profile.sysrootProfile===`c-base-v1`&&e===`C`&&s.options.activePath?.endsWith(`.c`)&&!h.length&&!Object.keys(r.env??{}).length?`c`:`full`,_=[];this.profile.prepareClang?_=await this.profile.prepareClang(g,i):await this.profile.prepareCommand({path:`/usr/local/bin/clang`,argv:[`clang`],env:Object.entries(r.env??{}).map(([e,t])=>new TextEncoder().encode(`${e}=${t}`)),cwd:d,stdin:null,stdout:null,stderr:null},i),i.throwIfAborted();let v=h.length===0&&Object.keys(r.env??{}).length===0,y=/* @__PURE__ */ new Set([c]);try{l=this.profile.container.fs.observeMutations()}catch{v=!1}let b=0,x=[],S=e=>{b+=new TextEncoder().encode(JSON.stringify(e)).byteLength,x.length<256&&b<=65536?x.push(structuredClone(e)):v=!1,this.emit(e)},C;try{C=this.profile.container.fs.captureFileVersion(f)}catch{}let w=/\.(?:cc|cpp|cxx|C)$/.test(s.options.activePath??``),T=e===`CPP`||w?`CPP`:`C`,E=T,D=!1;for(let e=0;e<h.length;e++){let t=h[e];if((/* @__PURE__ */ `-I.-isystem.-iquote.-idirafter.-include.-include-pch.-imacros.-isysroot.--sysroot.-resource-dir.-D.-U.-o.-L.-l.-B.-target.--target.-Xclang.-Xpreprocessor.-Xassembler.-Xlinker.-mllvm.-MF.-MT.-MQ`.split(`.`)).includes(t)){e++;continue}if((t===`-nostdinc`||t===`-nobuiltininc`)&&(D=!0),t.startsWith(`@`))E=void 0;else if(t.startsWith(`-x`)){let n=t===`-x`?h[++e]:t.slice(2);E=n===`none`?T:n===`c`||n===`c-header`||n===`cpp-output`?`C`:n===`c++`||n===`c++-header`||n===`c++-cpp-output`?`CPP`:void 0}}let O=E?Er(E,r).standardArg.slice(5):void 0,k=h.some(e=>e.startsWith(`@`)||e.startsWith(`-x`)),A=[];for(let e=0;e<_.length;e++){if(D&&_[e]===`-isystem`&&_[e+1]?.endsWith(`/include/wasm-idle/simd`)){e++;continue}A.push(_[e])}let j=[...A,`--target=wasm32-wasip1`,...E===`C`?[]:[`--driver-mode=g++`],...e===`C`&&k&&!w?[`-x`,`c`]:[],...O?[`-std=${O}`]:[],`-fcolor-diagnostics`,`-fno-exceptions`,...h],M=async(t,n=!1,i=S)=>{c.process=await this.spawn(c,`clang`,t,{cwd:d,env:r.env}),y.add(c.process.mutationSource??c.process.pid);let a=this.drain(c.process,e,o,!n,n,i);await c.process.stdin.getWriter().close();let s=await a;return this.success(s,c.signal)},N=this.headerKey(e,s.code,h,s.options,d,O),P=this.#s;if(P){P.key!==N&&P.controller.abort(new DOMException(`Header build superseded`,`AbortError`));let e=()=>P.controller.abort(i.reason);i.addEventListener(`abort`,e,{once:!0});try{await P.promise}finally{i.removeEventListener(`abort`,e)}i.throwIfAborted()}let F=[...j,`-Xclang`,`-fno-pch-timestamp`,`-c`,`-x`,`c++-header`,`/usr/share/wasm-sysroot/include/bits/stdc++.h`,`-o`],I=N?this.profile.toolchainIdentity?.(`full`):void 0,L=I?JSON.stringify([`container-stdcpp-pch-v1`,I,N,F]):void 0;if(N&&this.#a?.key!==N&&this.discardHeader(c),N&&!this.#a&&L){let e=await this.headerCache.read(L,i).catch(()=>void 0);i.throwIfAborted(),e?.byteLength&&e.byteLength<=Or&&!this.#a&&(this.#a={key:N,path:`/tmp/wasm-idle-stdcpp-${crypto.randomUUID()}.pch`,bytes:e,persistentKey:L})}let R=N===this.#a?.key?this.#a:void 0;if(R){let e=R;try{this.profile.container.fs.withMutationSource(c,()=>{try{this.profile.container.fs.unlink(e.path)}catch{}this.profile.container.fs.writeFile(e.path,e.bytes)})}catch{this.discardHeader(c),R=void 0}}let ee=[...j,s.options.activePath,`-lc-printscan-long-double`,`-o`,f],z;if(R){let e=[];z=await M([...j,`-include-pch`,R.path,...ee.slice(j.length)],!1,t=>{e.push(t)});let t=e.map(e=>e.name===`output`&&typeof e.data==`string`?e.data:``).join(``);if(!z&&Dr.test(t)){let e=R;this.discardHeader(c),e.persistentKey&&this.headerCache.remove(e.persistentKey).catch(()=>{}),z=await M(ee)}else{for(let t of e)S(t);z&&a?.set?.(95,`Compiled with precompiled <bits/stdc++.h>`)}}else z=await M(ee);if(z&&N&&!this.#a&&(this.#o={key:N,persistentKey:L,language:e,argv:F,cwd:d,env:r.env}),z){l?.hasChangesOutside(y)&&(v=!1),i.throwIfAborted();let t=this.profile.container.fs;try{let n=t.captureFileVersion(f),r=t.stat(f);if(n===C||!r.size||!(r.mode&73))return!1;this.#r.set(f,n),this.#t.set(e,{key:p,generation:t.generation,version:n,reusable:v,diagnostics:x})}catch{return!1}}return z}finally{l?.dispose(),this.#e.get(e)===c&&this.#e.delete(e)}}async run(e,t,n,r,i,a,o){if(this.#l)throw Error(`Clang runtime has been disposed`);i.throwIfAborted();let s=this.files.inputs(e,t,r),c=this.files.directory(e),l=this.artifact(e);if(!this.currentProgram(this.#t.get(e),this.key(e,s.code,n,s.options),l)&&!await this.prepare(e,t,n,r,i,a,o))return!1;let u=this.currentProgram(this.#t.get(e),this.key(e,s.code,n,s.options),l);if(!u)return!1;u.reusable||this.#t.delete(e);let d=new AbortController;i=AbortSignal.any([i,d.signal]);let f={language:e,phase:`run`,controller:d,signal:i};if(this.#e.has(e))throw Error(`${e} already has an active command`);this.#e.set(e,f);let p,m;try{let{programArgs:t}=Sr(e,n,r);f.process=p=await this.spawn(f,`wasm-run`,[l,...t],{cwd:c,env:r.env}),f.writer=f.process.stdin.getWriter(),m=this.drain(f.process,e,o),m.catch(()=>{}),a?.report?.({kind:`ready`,state:`running`,reason:`started`,label:`Container program started`});let[i]=await Promise.all([m,(async()=>{try{r.stdin===void 0?await this.flush(e):(await f.writer.write(new TextEncoder().encode(r.stdin)),await f.writer.close())}catch(e){if(e?.code!==`EPIPE`)throw e}})()]);return this.success(i,f.signal)}catch(e){try{await p?.terminate()}catch{}throw await m?.catch(()=>{}),e}finally{f.writer?.releaseLock(),this.#i.delete(e),this.#e.get(e)===f&&this.#e.delete(e),this.#o&&this.buildPendingHeader()}}buildPendingHeader(){if(this.#s)return this.#s.promise;let e=this.#o;if(this.#o=void 0,!e||this.#l)return Promise.resolve();let t=new AbortController,n={language:e.language,phase:`prepare`,controller:t,signal:t.signal},r=this.profile.container.fs,i=`/tmp/wasm-idle-stdcpp-${crypto.randomUUID()}.pch`,a;try{a=r.observeMutations()}catch{}let o=r.generation,s=/* @__PURE__ */ new Set([n]),c=(async()=>{let c;try{let t=await this.spawn(n,`clang`,[...e.argv,i],{cwd:e.cwd,env:e.env});s.add(t.mutationSource??t.pid),await t.stdin.getWriter().close();let a=await this.drain(t,e.language,0,!1,!0);if(this.success(a,n.signal)){let t=r.readFile(i);t.byteLength>0&&t.byteLength<=Or&&(c={key:e.key,path:i,bytes:t,persistentKey:e.persistentKey})}}catch{}if(c&&!t.signal.aborted&&!this.#l)this.discardHeader(n),this.#a=c,c.persistentKey&&this.headerCache.write(c.persistentKey,c.bytes).catch(()=>!1);else try{r.withMutationSource(n,()=>r.unlink(i))}catch{}if(a&&!a.hasChangesOutside(s))for(let e of this.#t.values())e.generation===o&&(e.generation=r.generation);a?.dispose(),this.#s?.controller===t&&(this.#s=void 0)})();return this.#s={key:e.key,language:e.language,controller:t,promise:c},c}async flush(e){let t=this.#e.get(e)?.writer;if(!t)return;let n=this.queue(e);for(let e of n.chunks.splice(0)){let r=new TextEncoder().encode(e);await t.write(r),n.size-=r.byteLength}n.eof&&(n.eof=!1,await t.close())}async write(e,t){let n=this.queue(e);if(n.size+=new TextEncoder().encode(t).length,n.size>8388608)throw Error(`Pending stdin exceeds its limit`);n.chunks.push(t),await this.flush(e)}async eof(e){this.queue(e).eof=!0,await this.flush(e)}async stop(e){this.#i.delete(e),this.#s?.language===e&&this.#s.controller.abort(new DOMException(`Command cancelled`,`AbortError`));let t=this.#e.get(e);t?.controller.abort(new DOMException(`Command cancelled`,`AbortError`)),await t?.process?.terminate()}clear(e){this.#i.delete(e)}inspect(){return[...this.#e.values()].map(e=>({language:e.language,phase:e.phase,pid:e.process?.pid,filesystem:`live`}))}async dispose(){if(this.#l=!0,this.#t.clear(),this.#o=void 0,this.#s?.controller.abort(new DOMException(`Clang runtime disposed`,`AbortError`)),await Promise.allSettled([...[...this.#e.keys()].map(e=>this.stop(e)),this.#s?.promise]),this.discardHeader(),!this.#e.size){let e=this.profile.container.fs;for(let[t,n]of this.#r)try{e.captureFileVersion(t)===n&&e.unlink(t)}catch{}let t=this.#n;if(t)try{e.lstat(t.path).inode===t.inode&&e.rmdir(t.path)}catch{}}this.#r.clear()}};const Ar=/* @__PURE__ */ new WeakSet;function jr(e){if(globalThis.document!==void 0||typeof globalThis.Worker!=`function`)throw Error(`The container owner requires a dedicated Worker realm`);if(Ar.has(globalThis))throw Error(`The container owner is already serving`);Ar.add(globalThis);let t=globalThis,n=``,r=!1,i=!1,a,o,s,c,l,u,d,f=!1,p,m=Promise.resolve(),g,_,v=new AbortController,y=/* @__PURE__ */ new Map,b=/* @__PURE__ */ new Map,x=globalThis.Worker,S=/* @__PURE__ */ new Set,C=!1;class w extends x{constructor(e,t){if(C||S.size>=64)throw Error(`Application worker admission limit reached`);super(e,t),S.add(this)}terminate(){S.delete(this)&&super.terminate()}}globalThis.Worker=w;let T=(e,r)=>t.postMessage({version:1,channel:n,id:e,...r}),E=e=>{i||T(e.requestId??0,{type:`event`,event:e})};function D(e,t,n=``){return typeof e==`string`?n===``||/(?:urls?|URLs?)$/i.test(n)?new URL(e,t).href:e:Array.isArray(e)?e.map(e=>D(e,t,n)):e&&typeof e==`object`&&Object.getPrototypeOf(e)===Object.prototype?Object.fromEntries(Object.entries(e).map(([e,n])=>[e,D(n,t,e)])):e}async function O(t){if(v.signal.throwIfAborted(),typeof t.workspaceId!=`string`||t.workspaceId.length>4096)throw Error(`Invalid workspace identifier`);let n=new URL(t.applicationRootURL);if(n.origin!==location.origin||!n.pathname.endsWith(`/`))throw Error(`Invalid application asset root`);if(o=new yr({runtimeAssets:D(t.runtimeAssets,n.href),emit:E,createBinding:e.createBinding}),crossOriginIsolated&&typeof SharedArrayBuffer==`function`){let{config:t,sdk:r}=await e.createBashConfiguration(n.href);v.signal.throwIfAborted();let u={Worker:w},d=ln({scope:u,maxWorkers:32}),f=new URL(t.sdkWorkerUrl).href,p=function(e,t){return new(new URL(String(e),location.href).href===f?u.Worker:w)(e,t)};Object.setPrototypeOf(p,x),Object.defineProperty(p,"prototype",{value:x.prototype}),globalThis.Worker=p,l=pr({languages:e.languages});try{let n=await er({config:t,sdk:r,workerGroup:d,shellCommands:e.shellCommands,adapters:[o.adapter,l.adapter],commands:{...o.commands,...l.commands},shellRoutes:{[l.route.path]:{command:l.route.command}},onInvocation:e=>{l?.onInvocation(e)}});i&&(await Promise.allSettled([n.dispose(),d.dispose()]),v.signal.throwIfAborted()),c=n}catch(e){throw await d.dispose().catch(()=>{}),e}a=c.container,s=new kr(c,o,E)}else a=te({adapters:[o.adapter],commands:o.commands,maxBytes:268435456,maxInodes:16384,maxProcesses:8,maxMemoryBytes:2**32});o.attach(a),g=a.fs.watch({maxQueuedEvents:32,signal:v.signal}).getReader(),(async()=>{try{for(;;){let{value:e,done:t}=await g.read();if(t)break;E({name:`workspace`,data:e})}}catch(e){v.signal.aborted||E({name:`shell-output`,data:{error:String(e)}})}})()}async function k(e={}){if(!c)throw Error(`Interactive shell requires cross-origin isolation. Batch Run is still available.`);if(f)throw Error(`Bash has exited. Reload this workspace to open a fresh shell.`);return d||(d=(async()=>{let t=e.cwd??`/workspace`;if(!/^\/workspace(?:\/[A-Z][A-Z0-9_]*)?$/.test(t))throw Error(`Invalid shell directory`);a.fs.mkdir(t,{recursive:!0});let n=l.setup(a.fs),r=t===`/workspace`?Promise.resolve():l.requestDirectory(t.slice(11));r.catch(()=>{});try{u=await c.startShell({cwd:t,args:[...n.args],mounts:[`/workspace`,`/tmp`,`/home/user`,n.mountPath],env:{...e.env,...n.env}},v.signal)}catch(e){throw l?.dispose(),e}p=u.stdin.getWriter();let i=async(e,t)=>{let n=e.getReader();try{for(;;){let{value:e,done:r}=await n.read();if(r)break;E({name:`shell-output`,data:{stream:t,bytes:e}})}}finally{n.releaseLock()}};Promise.all([u.exited,i(u.stdout,`stdout`),i(u.stderr,`stderr`)]).then(([e])=>{f=!0,l?.dispose(),E({name:`shell-output`,data:{stream:`stderr`,bytes:new TextEncoder().encode(`\nShell ${e.reason}; reload to open a new shell.\n`)}})}).catch(e=>{f=!0,l?.dispose(),E({name:`shell-output`,data:{error:e instanceof Error?e.message:String(e)}})});let o;try{await Promise.race([r,new Promise((e,t)=>{o=setTimeout(()=>t(/* @__PURE__ */ Error(`Bash workspace control did not become ready within 10 seconds`)),1e4)})])}catch(e){throw l?.dispose(),await u?.dispose(),e}finally{clearTimeout(o)}})(),d)}async function A(e){if(!p||f)throw Error(`Shell is not running`);let t=typeof e==`string`?new TextEncoder().encode(e.replaceAll(`\r
`,`
`).replaceAll(`\r`,`
`)):e;if(t.length>65536)throw Error(`Terminal input exceeds 64 KiB`);let n=m.catch(()=>{}).then(()=>p.write(t));m=n,await n}function j(){if(_)return _;i=!0,t.onmessage=null,_=Promise.resolve().then(async()=>{l?.dispose(),await Promise.allSettled([u?.dispose(),s?.dispose(),o?.dispose(),c?.dispose(),g?.cancel()]);try{await a?.dispose()}finally{C=!0;for(let e of[...S])e.terminate()}}),v.abort();for(let e of y.values())e.abort();return _}let M=/* @__PURE__ */ new Set([`debugCommand`,`debugPause`,`setBreakpoints`,`setSourceBreakpoints`,`debugEvaluate`,`debugEvaluateValue`,`debugSetSteppingOptions`,`debugVariables`,`debugScopes`,`debugFrameScopes`,`debugFrameName`,`debugReadMemory`,`debugWriteMemory`,`debugDataBreakpointInfo`,`debugSetDataBreakpoints`]);async function N(e,t,n,r){if(i&&e!==`dispose`)throw Error(`Container owner has been disposed`);let c=t[0],h={set:(e,t)=>T(r,{type:`progress`,progress:{kind:`set`,value:e,stage:t}}),report:e=>T(r,{type:`progress`,progress:{kind:`report`,event:e}})};if(e===`prewarm`)return s&&(c===`C`||c===`CPP`)?await s.prewarm(c,n):await o.prewarm(c,n);if([`load`,`prepare`,`run`].includes(e)){let[,i=``,a=!0,l=[],u={}]=t,d=u??{},f=!!s&&[`C`,`CPP`].includes(c)&&!d.debug&&(!d.debugMode||d.debugMode===`none`);if(b.set(c,f?`clang`:`engine`),f){if(e===`load`){o.inputs(c,i,d);return}return await s[e](c,i,l,d,n,h,r)}return await o.execute(e,c,i,a,l,d,n,h,r)}if(M.has(e))return await o.debug(c,e,t.slice(1));if(e===`write`||e===`eof`){let n=b.get(c)===`clang`&&s?s:o;return e===`write`?await n.write(c,t[1]):await n.eof(c)}if(e===`stop`){await Promise.all([s?.stop(c),o.stop(c)]);return}if(e===`clear`){s?.clear(c),b.get(c)===`engine`&&await o.clear(c);return}if(e===`restart`){await s?.stop(c),s?.clear(c),await o.restart(c);return}if(e===`syncWorkspace`)return o.syncWorkspace(c,t[1],t[2]);if(e===`syncWorkspaceDelta`){if(!Array.isArray(t[2])||!Array.isArray(t[3]))throw TypeError(`Workspace delta requires a baseline and project metadata`);return o.syncWorkspace(c,t[1],t[2],t[3])}if(e===`readWorkspace`)return o.readWorkspace(c);if(e===`readWorkspaceDelta`)return o.readWorkspaceDelta(c,t[1]);if(e===`listWorkspaceFiles`)return o.listWorkspaceFiles();if(e===`inspect`)return{...await a.inspect(),runtimeJobs:[...o.inspect(),...s?.inspect()??[]],shell:{running:!!u&&!f,closed:f,control:l?.inspect()},ownedWorkers:S.size};if(e===`shellStart`)return await k(t[0]);if(e===`shellSetDirectory`){if(await d,!u||f||!l)throw Error(`Shell is not running`);return await l.requestDirectory(c)}if(e===`shellSuspend`||e===`shellResume`){if(await d,!u||f||!l)return;try{return await l.requestPrompt(e===`shellSuspend`?`suspend`:`resume`,AbortSignal.any([n,v.signal,AbortSignal.timeout(2e3)]))}catch(e){throw e?.name===`TimeoutError`?Error(`Finish the current shell command before running a program.`):e}}if(e===`shellWrite`)return await A(t[0]);if(e===`shellEof`){await m,await p?.close();return}if(e===`shellInterrupt`){(u?.interrupt()??0)||await A(``);return}if(e===`shellDispose`){await u?.dispose(),l?.dispose(),f=!0;return}if(e===`dispose`)return await j();throw Error(`Unknown container operation`)}return t.onmessage=e=>{if(i)return;let t=e.data;if(!t||t.version!==1||typeof t.channel!=`string`||!Number.isSafeInteger(t.id))return;if(t.type===`init`){if(r)return;r=!0,n=t.channel,O(t.settings).then(()=>{i||T(0,{type:`result`,value:void 0})},e=>{i||T(0,{type:`error`,error:h(e)}),j()});return}if(!r||t.channel!==n)return;if(t.type===`cancel`){y.get(t.id)?.abort(new DOMException(`Operation cancelled`,`AbortError`));return}if(t.type!==`call`||typeof t.method!=`string`||!Array.isArray(t.args)||y.has(t.id))return;let a=new AbortController;y.set(t.id,a),N(t.method,t.args,a.signal,t.id).then(e=>T(t.id,{type:`result`,value:e}),e=>T(t.id,{type:`error`,error:h(e)})).finally(()=>y.delete(t.id))},{dispose:j}}const Mr=[{languageId:`APL`,load:async()=>{let{default:e}=await import(`./chunks/bxLQpdz7.js`);return new e}},{languageId:`MOONBIT`,load:async()=>{let{default:e}=await import(`./chunks/DDk8ZOZi.js`);return new e}},{languageId:`COQ`,load:async()=>{let{default:e}=await import(`./chunks/BOprpZzF.js`);return new e}},{languageId:`SMALLTALK`,load:async()=>{let{default:e}=await import(`./chunks/CZXXFCuG.js`);return new e}},{languageId:`DART`,load:async()=>{let{default:e}=await import(`./chunks/Bm9qVOdF.js`);return new e}},{languageId:`BC`,load:async()=>{let{default:e}=await import(`./chunks/Df_kDVpQ.js`);return new e}},{languageId:`UIUA`,load:async()=>{let{default:e}=await import(`./chunks/zgC6joCA.js`);return new e}},{languageId:`SED`,load:async()=>{let{default:e}=await import(`./chunks/OpfdSc8o.js`);return new e}},{languageId:`GRAPHQL`,load:async()=>{let{default:e}=await import(`./chunks/D1buyOL8.js`);return new e}},{languageId:`PICAT`,load:async()=>{let{default:e}=await import(`./chunks/DbK8_Qdt.js`);return new e}},{languageId:`PARIGP`,load:async()=>{let{default:e}=await import(`./chunks/BiMUjlU0.js`);return new e}},{languageId:`WREN`,load:async()=>{let[{default:e},{WREN_INTERPRETER:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/CPuwnuDL.js`)]);return new e(t)}},{languageId:`SQUIRREL`,load:async()=>{let[{default:e},{SQUIRREL_PROFILE:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/sTfQl3jm.js`)]);return new e(t)}},{languageId:`SCALA`,load:async()=>{let{default:e}=await import(`./chunks/WpE2kh2Z.js`);return new e}},{languageId:`GOLFSCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/jewHpmpU.js`);return new e}},{languageId:`APECODE`,load:async()=>{let{default:e}=await import(`./chunks/D8W5EXGt.js`);return new e}},{languageId:`LOLCODE`,load:async()=>{let[{default:e},{WASI_INTERPRETERS:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/Dte2v0zo.js`)]);return new e(t.LOLCODE)}},{languageId:`UHMLANG`,load:async()=>{let[{default:e},{WASI_INTERPRETERS:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/Dte2v0zo.js`)]);return new e(t.UHMLANG)}},{languageId:`AHEUI`,load:async()=>{let{default:e}=await import(`./chunks/C1pCCSjl.js`);return new e}},{languageId:`MALBOLGE`,load:async()=>{let[{default:e},{WASI_INTERPRETERS:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/Dte2v0zo.js`)]);return new e(t.MALBOLGE)}},{languageId:`WHITESPACE`,load:async()=>{let[{default:e},{WASI_INTERPRETERS:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/Dte2v0zo.js`)]);return new e(t.WHITESPACE)}},{languageId:`BEFUNGE93`,load:async()=>{let[{default:e},{WASI_INTERPRETERS:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/Dte2v0zo.js`)]);return new e(t.BEFUNGE93)}},{languageId:`BRAINFUCK`,load:async()=>{let[{default:e},{WASI_INTERPRETERS:t}]=await Promise.all([import(`./chunks/neFccNH-.js`),import(`./chunks/Dte2v0zo.js`)]);return new e(t.BRAINFUCK)}},{languageId:`C3`,load:async()=>{let{default:e}=await import(`./chunks/DhZsBjCe.js`);return new e}},{languageId:`PYTHON3`,load:async()=>{let{default:e}=await import(`./chunks/jri4ybAZ.js`);return new e}},{languageId:`HY`,load:async()=>{let{default:e}=await import(`./chunks/D0krorc_.js`);return new e}},{languageId:`C`,load:async()=>{let{default:e}=await import(`./chunks/Do7pr7Wj.js`);return new e(`C`)}},{languageId:`CPP`,load:async()=>{let{default:e}=await import(`./chunks/Do7pr7Wj.js`);return new e(`CPP`)}},{languageId:`OBJC`,load:async()=>{let{default:e}=await import(`./chunks/5ru5nnlX.js`);return new e}},{languageId:`OBJECTIVECXX`,load:async()=>{let{default:e}=await import(`./chunks/5ru5nnlX.js`);return new e(`OBJECTIVECXX`)}},{languageId:`JAVA`,load:async()=>{let{default:e}=await import(`./chunks/OTQ-JRfG.js`);return new e}},{languageId:`RUST`,load:async()=>{let{default:e}=await import(`./chunks/CXkC-SqO.js`);return new e}},{languageId:`GO`,load:async()=>{let{default:e}=await import(`./chunks/Dz9TnS--.js`);return new e}},{languageId:`D`,load:async()=>{let{default:e}=await import(`./chunks/DvmpVBmZ.js`);return new e}},{languageId:`CSHARP`,load:async()=>{let{default:e}=await import(`./chunks/C5mrO4Jg.js`);return new e(`CSHARP`)}},{languageId:`FSHARP`,load:async()=>{let{default:e}=await import(`./chunks/C5mrO4Jg.js`);return new e(`FSHARP`)}},{languageId:`VBNET`,load:async()=>{let{default:e}=await import(`./chunks/C5mrO4Jg.js`);return new e(`VBNET`)}},{languageId:`ELIXIR`,load:async()=>{let{default:e}=await import(`./chunks/Dk7PuwVz.js`);return new e}},{languageId:`ERLANG`,load:async()=>{let{default:e}=await import(`./chunks/Dk7PuwVz.js`);return new e(`ERLANG`)}},{languageId:`PROLOG`,load:async()=>{let{default:e}=await import(`./chunks/BY6ReYbD.js`);return new e}},{languageId:`GLEAM`,load:async()=>{let{default:e}=await import(`./chunks/DQOwD1wu.js`);return new e}},{languageId:`VERILOG`,load:async()=>{let{default:e}=await import(`./chunks/Dyn9lg4T.js`);return new e}},{languageId:`GRAIN`,load:async()=>{let{default:e}=await import(`./chunks/DPtjyXDJ.js`);return new e}},{languageId:`PERL`,load:async()=>{let{default:e}=await import(`./chunks/BBpA9E9I.js`);return new e}},{languageId:`TCL`,load:async()=>{let{default:e}=await import(`./chunks/DoX2J8DU.js`);return new e}},{languageId:`AWK`,load:async()=>{let{default:e}=await import(`./chunks/Bst5OtJX.js`);return new e}},{languageId:`PASCAL`,load:async()=>{let{default:e}=await import(`./chunks/Vma7SJ3X.js`);return new e}},{languageId:`CLOJURESCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/CJOCADpy.js`);return new e}},{languageId:`RESCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/CVAC1fdU.js`);return new e}},{languageId:`FORTH`,load:async()=>{let{default:e}=await import(`./chunks/DvhHlFKl.js`);return new e}},{languageId:`J`,load:async()=>{let{default:e}=await import(`./chunks/Cb9aRYnR.js`);return new e}},{languageId:`SML`,load:async()=>{let{default:e}=await import(`./chunks/Bmcxt9L8.js`);return new e}},{languageId:`BQN`,load:async()=>{let{default:e}=await import(`./chunks/B-HlGV0p.js`);return new e}},{languageId:`JANET`,load:async()=>{let{default:e}=await import(`./chunks/Br6gsfKA.js`);return new e}},{languageId:`JULIA`,load:async()=>{let{default:e}=await import(`./chunks/Cj_lTuI8.js`);return new e}},{languageId:`NIM`,load:async()=>{let{default:e}=await import(`./chunks/COxSg9wM.js`);return new e}},{languageId:`BASH`,load:async()=>{let{default:e}=await import(`./chunks/BYCDdXOA.js`);return new e}},{languageId:`LFORTRAN`,load:async()=>{let{default:e}=await import(`./chunks/DU5x0EVo.js`);return new e}},{languageId:`LEAN4`,load:async()=>{let{default:e}=await import(`./chunks/CE_P36av.js`);return new e}},{languageId:`FORTRAN`,load:async()=>{let{default:e}=await import(`./chunks/Qfjp2HaB.js`);return new e}},{languageId:`COBOL`,load:async()=>{let{default:e}=await import(`./chunks/CDqsj-K3.js`);return new e}},{languageId:`V`,load:async()=>{let{default:e}=await import(`./chunks/g2WHaRNm.js`);return new e}},{languageId:`TINYGO`,load:async()=>{let{default:e}=await import(`./chunks/-Y5PsIBq.js`);return new e}},{languageId:`OCAML`,load:async()=>{let{default:e}=await import(`./chunks/nLzNYYgN.js`);return new e}},{languageId:`JAVASCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/BSoqwW5h.js`);return new e(`JAVASCRIPT`)}},{languageId:`COFFEESCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/BSoqwW5h.js`);return new e(`COFFEESCRIPT`)}},{languageId:`TYPESCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/BSoqwW5h.js`);return new e(`TYPESCRIPT`)}},{languageId:`ASSEMBLYSCRIPT`,load:async()=>{let{default:e}=await import(`./chunks/CnUZ_bjv.js`);return new e}},{languageId:`WAT`,load:async()=>{let{default:e}=await import(`./chunks/CHawzw1R.js`);return new e}},{languageId:`WASM`,load:async()=>{let{default:e}=await import(`./chunks/neFccNH-.js`);return new e}},{languageId:`LUA`,load:async()=>{let{default:e}=await import(`./chunks/BRwmiPuL.js`);return new e}},{languageId:`FENNEL`,load:async()=>{let{default:e}=await import(`./chunks/DvApsGKQ.js`);return new e}},{languageId:`ZIG`,load:async()=>{let{default:e}=await import(`./chunks/DkQOwOAc.js`);return new e}},{languageId:`LISP`,load:async()=>{let{default:e}=await import(`./chunks/DBaTyyjM.js`);return new e}},{languageId:`COMMONLISP`,load:async()=>{let{default:e}=await import(`./chunks/BwAm52wJ.js`);return new e}},{languageId:`RUBY`,load:async()=>{let{default:e}=await import(`./chunks/vrC7kWIX.js`);return new e}},{languageId:`HASKELL`,load:async()=>{let{default:e}=await import(`./chunks/BOVyPnO5.js`);return new e}},{languageId:`R`,load:async()=>{let{default:e}=await import(`./chunks/BpurRfdb.js`);return new e}},{languageId:`OCTAVE`,load:async()=>{let{default:e}=await import(`./chunks/B9mR8wh3.js`);return new e}},{languageId:`DUCKDB`,load:async()=>{let{default:e}=await import(`./chunks/DEpoRHcI.js`);return new e}},{languageId:`SQLITE`,load:async()=>{let{default:e}=await import(`./chunks/B4NJEy3p.js`);return new e}},{languageId:`POSTGRESQL`,load:async()=>{let{default:e}=await import(`./chunks/CuJ2gMdi.js`);return new e}},{languageId:`PHP`,load:async()=>{let{default:e}=await import(`./chunks/DtF8vM5H.js`);return new e}}],Nr=/* @__PURE__ */ new Map;for(let e of Mr){if(Nr.has(e.languageId))throw Error(`Duplicate sandbox route: ${e.languageId}`);Nr.set(e.languageId,e)}for(let e of Ge)if(!Nr.has(e))throw Error(`Missing sandbox route: ${e}`);[...Ge];function Pr(e,t={}){let n=new re,r=vt(e,(async e=>{let t=await Fr(e);try{t.setRuntimeAssetCache?.(n)}catch{}return t}),t),i=r.dispose.bind(r);return r.dispose=()=>i().finally(()=>n.dispose()),r}async function Fr(e,t,n={}){let r=Ye(e);if(!Xe(r))throw Error(`Unsupported language: ${e}`);let i=Nr.get(r);if(!i)throw Error(`Missing sandbox route: ${r}`);return t?Pr(t,n).load(r):i.load()}const Ir=Object.freeze(/* @__PURE__ */ `base64.basename.cat.cmp.cp.cut.diff.dirname.echo.false.find.grep.gunzip.gzip.head.hexdump.ln.ls.mkdir.mv.od.printf.pwd.readlink.realpath.rm.rmdir.sed.sha256sum.sort.stat.tail.tar.tee.touch.tr.true.uniq.unzip.wc`.split(`.`)),Lr=Object.freeze([`busybox`,...Ir]),Rr=Object.freeze([`echo`,`false`,`printf`,`pwd`,`true`]),zr=Object.freeze(Lr.filter(e=>!Rr.includes(e))),Br=[`JSON`,`YAML`,`TOML`,`HTML`,`CSS`,`MARKDOWN`],Vr=[...Ge.map(e=>e===`PYTHON3`?`PYTHON`:e),...Br],$=Object.entries({APL:{label:`GNU APL`,editorLanguage:`plaintext`,supportsArgs:!0},MOONBIT:{label:`MoonBit`,editorLanguage:`plaintext`,supportsArgs:!0,argsLabel:`Program arguments`},COQ:{label:`Coq 8.17.1`,editorLanguage:`plaintext`,compilerDiagnostics:!0,diagnosticMarkers:!0},SMALLTALK:{label:`Smalltalk (Amber)`,editorLanguage:`plaintext`,supportsArgs:!0,argsLabel:`Program arguments`},BC:{label:`bc 7.0.3`,editorLanguage:`plaintext`,supportsArgs:!0},UIUA:{label:`Uiua`,editorLanguage:`plaintext`,supportsArgs:!0},SED:{label:`sed — BusyBox`,editorLanguage:`plaintext`,supportsArgs:!0,argsLabel:`sed options / input files`},PICAT:{label:`Picat`,editorLanguage:`plaintext`},PARIGP:{label:`PARI/GP`,editorLanguage:`plaintext`},WREN:{label:`Wren`,editorLanguage:`plaintext`},SQUIRREL:{label:`Squirrel`,editorLanguage:`cpp`},UHMLANG:{label:`UHMLANG (엄준식)`,editorLanguage:`plaintext`},LOLCODE:{label:`LOLCODE 1.3`,editorLanguage:`plaintext`},APECODE:{label:`APECode`,editorLanguage:`plaintext`},GOLFSCRIPT:{label:`GolfScript`,editorLanguage:`plaintext`,supportsArgs:!0,argsLabel:`Interpreter options / -- values`},AHEUI:{label:`Aheui`,editorLanguage:`plaintext`},MALBOLGE:{label:`Malbolge`,editorLanguage:`plaintext`},WHITESPACE:{label:`Whitespace`,editorLanguage:`plaintext`},BRAINFUCK:{label:`Brainfuck`,editorLanguage:`plaintext`},BEFUNGE93:{label:`Befunge-93`,editorLanguage:`plaintext`},C3:{label:`C3 (byte ABI)`,editorLanguage:`c`,runtimeLspCapability:`c3`,lspLanguageOverride:`c3`,compilerDiagnostics:!0,diagnosticMarkers:!0},C:{label:`C`,editorLanguage:`c`,lspProvider:`clangd`,supportsArgs:!0,diagnosticMarkers:!0},CPP:{label:`C++`,editorLanguage:`cpp`,lspProvider:`clangd`,supportsArgs:!0,diagnosticMarkers:!0},OBJC:{label:`Objective-C`,editorLanguage:`objective-c`,lspProvider:`clangd`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},OBJECTIVECXX:{label:`Objective-C++`,editorLanguage:`objective-c`,lspProvider:`clangd`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},PYTHON:{label:`Python — Pyodide`,editorLanguage:`python`,diagnosticMarkers:!0},JAVA:{label:`Java`,editorLanguage:`java`,runtimeLspCapability:`java`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},RUST:{label:`Rust`,editorLanguage:`rust`,runtimeLspCapability:`rust`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},GO:{label:`Go`,editorLanguage:`go`,runtimeLspCapability:`go`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},D:{label:`D`,editorLanguage:`d`,runtimeLspCapability:`d`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},CSHARP:{label:`C#`,editorLanguage:`csharp`,lspProvider:`dotnet`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},FSHARP:{label:`F#`,editorLanguage:`fsharp`,lspProvider:`dotnet`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},VBNET:{label:`VB.NET`,editorLanguage:`vb`,lspProvider:`dotnet`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},ELIXIR:{label:`Elixir`,editorLanguage:`elixir`,runtimeLspCapability:`elixir`,diagnosticMarkers:!0},ERLANG:{label:`Erlang`,editorLanguage:`erlang`,runtimeLspCapability:`erlang`,diagnosticMarkers:!0},PROLOG:{label:`Prolog`,editorLanguage:`prolog`,runtimeLspCapability:`prolog`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},DART:{label:`Dart 3.14`,editorLanguage:`dart`,supportsArgs:!0,argsLabel:`Program arguments`},SCALA:{label:`Scala 3 — Scala.js (experimental)`,editorLanguage:`scala`,supportsArgs:!0,argsLabel:`Program arguments`,compilerDiagnostics:!0,diagnosticMarkers:!0},GLEAM:{label:`Gleam`,editorLanguage:`gleam`,runtimeLspCapability:`gleam`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},VERILOG:{label:`Verilog — Icarus`,editorLanguage:`plaintext`,supportsArgs:!0,argsLabel:`Simulation plusargs`,compilerDiagnostics:!0,diagnosticMarkers:!0},GRAIN:{label:`Grain`,lspLanguageOverride:`grain`,editorLanguage:`rust`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},PERL:{label:`Perl`,editorLanguage:`perl`,runtimeLspCapability:`perl`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},TCL:{label:`Tcl`,editorLanguage:`tcl`,runtimeLspCapability:`tcl`,supportsArgs:!0,diagnosticMarkers:!0},AWK:{label:`AWK`,editorLanguage:`awk`,runtimeLspCapability:`awk`,supportsArgs:!0,diagnosticMarkers:!0},PASCAL:{label:`Pascal`,editorLanguage:`pascal`,runtimeLspCapability:`pascal`,diagnosticMarkers:!0},FORTH:{label:`Forth`,editorLanguage:`forth`,runtimeLspCapability:`forth`,diagnosticMarkers:!0},J:{label:`J`,editorLanguage:`j`},SML:{label:`Standard ML`,editorLanguage:`plaintext`,supportsArgs:!0},BQN:{label:`BQN`,editorLanguage:`bqn`},JANET:{label:`Janet`,editorLanguage:`janet`,runtimeLspCapability:`janet`,diagnosticMarkers:!0},JULIA:{label:`Julia 1.3.0-DEV.560 (legacy)`,editorLanguage:`julia`,diagnosticMarkers:!0},NIM:{label:`Nim`,editorLanguage:`nim`,diagnosticMarkers:!0,runtimeLspCapability:`nim`},BASH:{label:`Bash`,editorLanguage:`shell`,lspLanguageOverride:`bash`,runtimeLspCapability:`bash`,supportsArgs:!0,diagnosticMarkers:!0},CLOJURESCRIPT:{label:`ClojureScript`,editorLanguage:`clojure`,supportsArgs:!0},RESCRIPT:{label:`ReScript`,lspLanguageOverride:`rescript`,runtimeLspCapability:`rescript`,editorLanguage:`rust`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},HY:{label:`Hy — Pyodide`,editorLanguage:`clojure`},OCAML:{label:`OCaml`,editorLanguage:`ocaml`,runtimeLspCapability:`ocaml`,compilerDiagnostics:!0,diagnosticMarkers:!0},JAVASCRIPT:{label:`JavaScript — Browser`,editorLanguage:`javascript`,lspProvider:`typescript`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},COFFEESCRIPT:{label:`CoffeeScript`,editorLanguage:`coffeescript`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},TYPESCRIPT:{label:`TypeScript`,editorLanguage:`typescript`,lspProvider:`typescript`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},ASSEMBLYSCRIPT:{label:`AssemblyScript`,editorLanguage:`typescript`,lspLanguageOverride:`assemblyscript`,compilerDiagnostics:!0,diagnosticMarkers:!0},WAT:{label:`WAT`,editorLanguage:`wat`,compilerDiagnostics:!0,diagnosticMarkers:!0},WASM:{label:`WASM`,editorLanguage:`wasm`,runtimeLspCapability:`wasm`,diagnosticMarkers:!0},LUA:{label:`Lua`,editorLanguage:`lua`,runtimeLspCapability:`lua`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},FENNEL:{label:`Fennel`,editorLanguage:`clojure`,lspLanguageOverride:`fennel`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},ZIG:{label:`Zig`,editorLanguage:`zig`,runtimeLspCapability:`zig`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},LISP:{label:`Scheme — Puppy Scheme`,editorLanguage:`lisp`,runtimeLspCapability:`lisp`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},COMMONLISP:{label:`Common Lisp — ECL`,editorLanguage:`clojure`},RUBY:{label:`Ruby`,editorLanguage:`ruby`,runtimeLspCapability:`ruby`,supportsArgs:!0,compilerDiagnostics:!0},HASKELL:{label:`Haskell`,editorLanguage:`haskell`,runtimeLspCapability:`haskell`,compilerDiagnostics:!0,diagnosticMarkers:!0},R:{label:`R`,editorLanguage:`r`,runtimeLspCapability:`r`,supportsArgs:!0,diagnosticMarkers:!0},OCTAVE:{label:`MATLAB-compatible — GNU Octave`,editorLanguage:`octave`,runtimeLspCapability:`octave`,supportsArgs:!0,diagnosticMarkers:!0},LFORTRAN:{label:`LFortran (experimental)`,editorLanguage:`fortran`,compilerDiagnostics:!0,diagnosticMarkers:!0},LEAN4:{label:`Lean 4`,editorLanguage:`lean4`,runtimeLspCapability:`lean4`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},FORTRAN:{label:`Fortran`,editorLanguage:`fortran`,runtimeLspCapability:`fortran`,diagnosticMarkers:!0},COBOL:{label:`COBOL`,editorLanguage:`cobol`,runtimeLspCapability:`cobol`,supportsArgs:!0,diagnosticMarkers:!0},V:{label:`V`,editorLanguage:`go`,runtimeLspCapability:`v`,lspLanguageOverride:`v`,supportsArgs:!0,diagnosticMarkers:!0},TINYGO:{label:`TinyGo`,editorLanguage:`go`,supportsArgs:!0,compilerDiagnostics:!0,diagnosticMarkers:!0},GRAPHQL:{label:`GraphQL`,editorLanguage:`graphql`,diagnosticMarkers:!0},DUCKDB:{label:`SQL — DuckDB`,editorLanguage:`sql`,lspLanguageOverride:`duckdb`},SQLITE:{label:`SQL — SQLite dialect`,editorLanguage:`sql`,runtimeLspCapability:`sql`,compilerDiagnostics:!0},POSTGRESQL:{label:`SQL — PostgreSQL (PGlite)`,editorLanguage:`pgsql`,lspLanguageOverride:`postgresql`,runtimeLspCapability:`postgresql`,compilerDiagnostics:!0,diagnosticMarkers:!0},PHP:{label:`PHP`,editorLanguage:`php`,runtimeLspCapability:`php`,supportsArgs:!0,compilerDiagnostics:!0},JSON:{label:`JSON`,editorLanguage:`json`,diagnosticMarkers:!0},YAML:{label:`YAML`,editorLanguage:`yaml`,diagnosticMarkers:!0},TOML:{label:`TOML`,editorLanguage:`toml`,diagnosticMarkers:!0},HTML:{label:`HTML`,editorLanguage:`html`,diagnosticMarkers:!0},CSS:{label:`CSS`,editorLanguage:`css`,diagnosticMarkers:!0},MARKDOWN:{label:`Markdown`,editorLanguage:`markdown`,diagnosticMarkers:!0}});Object.fromEntries($.map(([e,t])=>[e,t.label])),Object.fromEntries($.map(([e,t])=>[e,t.editorLanguage])),new Set($.filter(([,e])=>e.lspProvider===`clangd`).map(([e])=>e)),new Set($.filter(([,e])=>e.lspProvider===`dotnet`).map(([e])=>e)),new Set($.filter(([,e])=>e.lspProvider===`typescript`).map(([e])=>e)),Object.fromEntries($.filter(([,e])=>e.lspLanguageOverride!==void 0).map(([e,t])=>[e,t.lspLanguageOverride])),new Set(Br),Object.fromEntries($.filter(([,e])=>e.runtimeLspCapability!==void 0).map(([e,t])=>[e,t.runtimeLspCapability])),new Set($.filter(([,e])=>e.supportsArgs).map(([e])=>e)),Object.fromEntries($.filter(([,e])=>e.argsLabel!==void 0).map(([e,t])=>[e,t.argsLabel])),new Set($.filter(([,e])=>e.compilerDiagnostics).map(([e])=>e)),new Set($.filter(([,e])=>e.diagnosticMarkers).map(([,e])=>e.editorLanguage));const Hr={distribution:{schemaVersion:1,packages:[{id:`shell`,identity:`sha256:e4fe2cf474b0276d79c0899ab233f2f1a0fca3ad494c842345a21ea5ed69c711`,dependencies:[],mount:`/opt/toolchains/bash`,producer:{repository:`https://github.com/seo-rii/wasm-idle`,revision:`65c335b48fe2fade4f24d4c8ff00c03f5c9b16b3`,receiptSha256:`4953449c949841bdf8cc17d40103e5cf2be466a39da695ef89ebefb1d2645d64`},capabilities:[`wasix`],assets:[{id:`sdk`,url:`https://seo-rii.github.io/wasm-idle/container-app/objects/522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce/sdk.wasm`,encoding:`identity`,delivery:{bytes:9246938,sha256:`522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce`,mediaType:`application/wasm`},logical:{bytes:9246938,sha256:`522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce`,mediaType:`application/wasm`}},{id:`bash`,url:`https://seo-rii.github.io/wasm-idle/container-app/objects/7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604/bash.webc.bin`,encoding:`identity`,delivery:{bytes:1814180,sha256:`7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604`,mediaType:`application/octet-stream`},logical:{bytes:1814180,sha256:`7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604`,mediaType:`application/octet-stream`}}],files:[{path:`sdk.wasm`,asset:`sdk`,executable:!1},{path:`bash.webc`,asset:`bash`,executable:!1}]},{id:`busybox`,identity:`sha256:30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40`,dependencies:[],mount:`/opt/toolchains/busybox`,producer:{repository:`https://github.com/seo-rii/wasm-idle`,revision:`8ead09726cfed3c758c9a6b827bf1fa020549dd4`,receiptSha256:`a726fa35c9959dbe85c9dfec17ddad9004ef43c403658d71c2080180afa084ad`},capabilities:[`wasi-preview1`],assets:[{id:`busybox`,url:`https://seo-rii.github.io/wasm-idle/container-app/objects/30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40/busybox.wasm`,encoding:`identity`,delivery:{bytes:634885,sha256:`30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40`,mediaType:`application/wasm`},logical:{bytes:634885,sha256:`30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40`,mediaType:`application/wasm`}}],files:[{path:`bin/busybox`,asset:`busybox`,executable:!0}]},{id:`llvm`,identity:`sha256:3345df4ab866088df3deabcd2afcb0802c3697603bc05e7ecc0f5ee386ea4375`,dependencies:[],mount:`/opt/toolchains/llvm`,producer:{repository:`https://github.com/llvm/llvm-project`,revision:`ca7933e47d3a3451d81e72ac174dcb5aa28b59d1`,receiptSha256:`7a099d99a33b562ffb4c7126b57e5abb0e8e454089ecda2efd0ce0c15e031fd9`},capabilities:[`wasi-preview1`,`llvm-tool-host-exec-v1`],assets:[{id:`clang`,encoding:`gzip`,delivery:{bytes:16270174,sha256:`eeee4f23e80b03cdd7b98c6722801f6e21143e67d83301a667acc7b70aba31ba`,mediaType:`application/octet-stream`},logical:{bytes:51965041,sha256:`e0b548b70e13ad9620c1f47a1ef3f552b74cea586866ef1d8dcc0558c87f50e3`,mediaType:`application/wasm`},url:`https://seo-rii.github.io/wasm-idle/container-app/objects/eeee4f23e80b03cdd7b98c6722801f6e21143e67d83301a667acc7b70aba31ba/clang.wasm.gz.bin`},{id:`lld`,encoding:`gzip`,delivery:{bytes:8178107,sha256:`dd9279345172fae1aef049ffcaf7531f945d85df08d97ea2ffce90581e9eee2d`,mediaType:`application/octet-stream`},logical:{bytes:24938493,sha256:`3da2fc3d37702d3d56bce834672912334e36d245efaf97fbdda7e4b5e810134a`,mediaType:`application/wasm`},url:`https://seo-rii.github.io/wasm-idle/container-app/objects/dd9279345172fae1aef049ffcaf7531f945d85df08d97ea2ffce90581e9eee2d/lld.wasm.gz.bin`}],files:[{path:`bin/llvm`,asset:`clang`,executable:!0},{path:`bin/wasm-ld`,asset:`lld`,executable:!0}]},{id:`llvm-sysroot-c`,identity:`sha256:097889de402c394b65561a269e4106b26d8df3ae154cc20bfe3d951d9a1242c7`,producer:{repository:`https://github.com/llvm/llvm-project`,revision:`ca7933e47d3a3451d81e72ac174dcb5aa28b59d1`,receiptSha256:`7a099d99a33b562ffb4c7126b57e5abb0e8e454089ecda2efd0ce0c15e031fd9`},dependencies:[],mount:`/opt/toolchains/llvm-sysroot-c`,capabilities:[],assets:[{id:`sysroot-c`,url:`https://seo-rii.github.io/wasm-idle/container-app/objects/670cf09dcb37d920f958ae68d0bc6655aba56e63153204239fc517708525f611/sysroot-c.tar.gz.bin`,encoding:`gzip`,delivery:{bytes:1965206,sha256:`670cf09dcb37d920f958ae68d0bc6655aba56e63153204239fc517708525f611`,mediaType:`application/octet-stream`},logical:{bytes:11945472,sha256:`097889de402c394b65561a269e4106b26d8df3ae154cc20bfe3d951d9a1242c7`,mediaType:`application/octet-stream`}}],files:[{path:`sysroot.tar`,asset:`sysroot-c`,executable:!1}]},{id:`llvm-sysroot-cxx`,identity:`sha256:6ed2cc0f8e685949758343bf79df7e158a7dd64d59dbd1c9d91355ae64598120`,producer:{repository:`https://github.com/llvm/llvm-project`,revision:`ca7933e47d3a3451d81e72ac174dcb5aa28b59d1`,receiptSha256:`7a099d99a33b562ffb4c7126b57e5abb0e8e454089ecda2efd0ce0c15e031fd9`},dependencies:[],mount:`/opt/toolchains/llvm-sysroot-cxx`,capabilities:[],assets:[{id:`sysroot-cxx`,url:`https://seo-rii.github.io/wasm-idle/container-app/objects/ee8f1395e7e5281d9e706b67e5b51910cf070730b5e2271aa559336d63968510/sysroot-cxx.tar.gz.bin`,encoding:`gzip`,delivery:{bytes:4776132,sha256:`ee8f1395e7e5281d9e706b67e5b51910cf070730b5e2271aa559336d63968510`,mediaType:`application/octet-stream`},logical:{bytes:23380992,sha256:`6ed2cc0f8e685949758343bf79df7e158a7dd64d59dbd1c9d91355ae64598120`,mediaType:`application/octet-stream`}}],files:[{path:`sysroot.tar`,asset:`sysroot-cxx`,executable:!1}]}],commands:[{name:`busybox`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`busybox`,prefixArgs:[]},{name:`base64`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`base64`,prefixArgs:[]},{name:`basename`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`basename`,prefixArgs:[]},{name:`cat`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`cat`,prefixArgs:[]},{name:`cmp`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`cmp`,prefixArgs:[]},{name:`cp`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`cp`,prefixArgs:[]},{name:`cut`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`cut`,prefixArgs:[]},{name:`diff`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`diff`,prefixArgs:[]},{name:`dirname`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`dirname`,prefixArgs:[]},{name:`echo`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`echo`,prefixArgs:[]},{name:`false`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`false`,prefixArgs:[]},{name:`find`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`find`,prefixArgs:[]},{name:`grep`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`grep`,prefixArgs:[]},{name:`gunzip`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`gunzip`,prefixArgs:[]},{name:`gzip`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`gzip`,prefixArgs:[]},{name:`head`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`head`,prefixArgs:[]},{name:`hexdump`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`hexdump`,prefixArgs:[]},{name:`ln`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`ln`,prefixArgs:[]},{name:`ls`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`ls`,prefixArgs:[]},{name:`mkdir`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`mkdir`,prefixArgs:[]},{name:`mv`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`mv`,prefixArgs:[]},{name:`od`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`od`,prefixArgs:[]},{name:`printf`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`printf`,prefixArgs:[]},{name:`pwd`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`pwd`,prefixArgs:[]},{name:`readlink`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`readlink`,prefixArgs:[]},{name:`realpath`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`realpath`,prefixArgs:[]},{name:`rm`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`rm`,prefixArgs:[]},{name:`rmdir`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`rmdir`,prefixArgs:[]},{name:`sed`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`sed`,prefixArgs:[]},{name:`sha256sum`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`sha256sum`,prefixArgs:[]},{name:`sort`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`sort`,prefixArgs:[]},{name:`stat`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`stat`,prefixArgs:[]},{name:`tail`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`tail`,prefixArgs:[]},{name:`tar`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`tar`,prefixArgs:[]},{name:`tee`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`tee`,prefixArgs:[]},{name:`touch`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`touch`,prefixArgs:[]},{name:`tr`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`tr`,prefixArgs:[]},{name:`true`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`true`,prefixArgs:[]},{name:`uniq`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`uniq`,prefixArgs:[]},{name:`unzip`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`unzip`,prefixArgs:[]},{name:`wc`,package:`busybox`,adapter:`wasi-preview1-live`,path:`bin/busybox`,argv0:`wc`,prefixArgs:[]},{name:`clang`,package:`llvm`,adapter:`llvm-clang-tool-host-live-v1`,path:`bin/llvm`,argv0:`/opt/toolchains/llvm/bin/llvm`,prefixArgs:[`clang`,`--target=wasm32-wasi`,`-fuse-ld=/opt/toolchains/llvm/bin/wasm-ld`,`--sysroot=/usr/share/wasm-sysroot`,`-resource-dir=/usr/share/wasm-sysroot/lib/clang/22`,`-Wl,--max-memory=67108864`]}],distributionId:`website-bc7a0d3bfe795fb289381d6e2bc7dafd195c2554de11388c99b48d9838b7f7cc`},config:{manifest:`{
  "schemaVersion": 1,
  "packages": [
    {
      "id": "shell",
      "identity": "sha256:e4fe2cf474b0276d79c0899ab233f2f1a0fca3ad494c842345a21ea5ed69c711",
      "dependencies": [],
      "mount": "/opt/toolchains/bash",
      "producer": {
        "repository": "https://github.com/seo-rii/wasm-idle",
        "revision": "65c335b48fe2fade4f24d4c8ff00c03f5c9b16b3",
        "receiptSha256": "4953449c949841bdf8cc17d40103e5cf2be466a39da695ef89ebefb1d2645d64"
      },
      "capabilities": [
        "wasix"
      ],
      "assets": [
        {
          "id": "sdk",
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce/sdk.wasm",
          "encoding": "identity",
          "delivery": {
            "bytes": 9246938,
            "sha256": "522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce",
            "mediaType": "application/wasm"
          },
          "logical": {
            "bytes": 9246938,
            "sha256": "522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce",
            "mediaType": "application/wasm"
          }
        },
        {
          "id": "bash",
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604/bash.webc.bin",
          "encoding": "identity",
          "delivery": {
            "bytes": 1814180,
            "sha256": "7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604",
            "mediaType": "application/octet-stream"
          },
          "logical": {
            "bytes": 1814180,
            "sha256": "7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604",
            "mediaType": "application/octet-stream"
          }
        }
      ],
      "files": [
        {
          "path": "sdk.wasm",
          "asset": "sdk",
          "executable": false
        },
        {
          "path": "bash.webc",
          "asset": "bash",
          "executable": false
        }
      ]
    },
    {
      "id": "busybox",
      "identity": "sha256:30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40",
      "dependencies": [],
      "mount": "/opt/toolchains/busybox",
      "producer": {
        "repository": "https://github.com/seo-rii/wasm-idle",
        "revision": "8ead09726cfed3c758c9a6b827bf1fa020549dd4",
        "receiptSha256": "a726fa35c9959dbe85c9dfec17ddad9004ef43c403658d71c2080180afa084ad"
      },
      "capabilities": [
        "wasi-preview1"
      ],
      "assets": [
        {
          "id": "busybox",
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40/busybox.wasm",
          "encoding": "identity",
          "delivery": {
            "bytes": 634885,
            "sha256": "30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40",
            "mediaType": "application/wasm"
          },
          "logical": {
            "bytes": 634885,
            "sha256": "30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40",
            "mediaType": "application/wasm"
          }
        }
      ],
      "files": [
        {
          "path": "bin/busybox",
          "asset": "busybox",
          "executable": true
        }
      ]
    },
    {
      "id": "llvm",
      "identity": "sha256:3345df4ab866088df3deabcd2afcb0802c3697603bc05e7ecc0f5ee386ea4375",
      "dependencies": [],
      "mount": "/opt/toolchains/llvm",
      "producer": {
        "repository": "https://github.com/llvm/llvm-project",
        "revision": "ca7933e47d3a3451d81e72ac174dcb5aa28b59d1",
        "receiptSha256": "7a099d99a33b562ffb4c7126b57e5abb0e8e454089ecda2efd0ce0c15e031fd9"
      },
      "capabilities": [
        "wasi-preview1",
        "llvm-tool-host-exec-v1"
      ],
      "assets": [
        {
          "id": "clang",
          "encoding": "gzip",
          "delivery": {
            "bytes": 16270174,
            "sha256": "eeee4f23e80b03cdd7b98c6722801f6e21143e67d83301a667acc7b70aba31ba",
            "mediaType": "application/octet-stream"
          },
          "logical": {
            "bytes": 51965041,
            "sha256": "e0b548b70e13ad9620c1f47a1ef3f552b74cea586866ef1d8dcc0558c87f50e3",
            "mediaType": "application/wasm"
          },
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/eeee4f23e80b03cdd7b98c6722801f6e21143e67d83301a667acc7b70aba31ba/clang.wasm.gz.bin"
        },
        {
          "id": "lld",
          "encoding": "gzip",
          "delivery": {
            "bytes": 8178107,
            "sha256": "dd9279345172fae1aef049ffcaf7531f945d85df08d97ea2ffce90581e9eee2d",
            "mediaType": "application/octet-stream"
          },
          "logical": {
            "bytes": 24938493,
            "sha256": "3da2fc3d37702d3d56bce834672912334e36d245efaf97fbdda7e4b5e810134a",
            "mediaType": "application/wasm"
          },
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/dd9279345172fae1aef049ffcaf7531f945d85df08d97ea2ffce90581e9eee2d/lld.wasm.gz.bin"
        }
      ],
      "files": [
        {
          "path": "bin/llvm",
          "asset": "clang",
          "executable": true
        },
        {
          "path": "bin/wasm-ld",
          "asset": "lld",
          "executable": true
        }
      ]
    },
    {
      "id": "llvm-sysroot-c",
      "identity": "sha256:097889de402c394b65561a269e4106b26d8df3ae154cc20bfe3d951d9a1242c7",
      "producer": {
        "repository": "https://github.com/llvm/llvm-project",
        "revision": "ca7933e47d3a3451d81e72ac174dcb5aa28b59d1",
        "receiptSha256": "7a099d99a33b562ffb4c7126b57e5abb0e8e454089ecda2efd0ce0c15e031fd9"
      },
      "dependencies": [],
      "mount": "/opt/toolchains/llvm-sysroot-c",
      "capabilities": [],
      "assets": [
        {
          "id": "sysroot-c",
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/670cf09dcb37d920f958ae68d0bc6655aba56e63153204239fc517708525f611/sysroot-c.tar.gz.bin",
          "encoding": "gzip",
          "delivery": {
            "bytes": 1965206,
            "sha256": "670cf09dcb37d920f958ae68d0bc6655aba56e63153204239fc517708525f611",
            "mediaType": "application/octet-stream"
          },
          "logical": {
            "bytes": 11945472,
            "sha256": "097889de402c394b65561a269e4106b26d8df3ae154cc20bfe3d951d9a1242c7",
            "mediaType": "application/octet-stream"
          }
        }
      ],
      "files": [
        {
          "path": "sysroot.tar",
          "asset": "sysroot-c",
          "executable": false
        }
      ]
    },
    {
      "id": "llvm-sysroot-cxx",
      "identity": "sha256:6ed2cc0f8e685949758343bf79df7e158a7dd64d59dbd1c9d91355ae64598120",
      "producer": {
        "repository": "https://github.com/llvm/llvm-project",
        "revision": "ca7933e47d3a3451d81e72ac174dcb5aa28b59d1",
        "receiptSha256": "7a099d99a33b562ffb4c7126b57e5abb0e8e454089ecda2efd0ce0c15e031fd9"
      },
      "dependencies": [],
      "mount": "/opt/toolchains/llvm-sysroot-cxx",
      "capabilities": [],
      "assets": [
        {
          "id": "sysroot-cxx",
          "url": "https://seo-rii.github.io/wasm-idle/container-app/objects/ee8f1395e7e5281d9e706b67e5b51910cf070730b5e2271aa559336d63968510/sysroot-cxx.tar.gz.bin",
          "encoding": "gzip",
          "delivery": {
            "bytes": 4776132,
            "sha256": "ee8f1395e7e5281d9e706b67e5b51910cf070730b5e2271aa559336d63968510",
            "mediaType": "application/octet-stream"
          },
          "logical": {
            "bytes": 23380992,
            "sha256": "6ed2cc0f8e685949758343bf79df7e158a7dd64d59dbd1c9d91355ae64598120",
            "mediaType": "application/octet-stream"
          }
        }
      ],
      "files": [
        {
          "path": "sysroot.tar",
          "asset": "sysroot-cxx",
          "executable": false
        }
      ]
    }
  ],
  "commands": [
    {
      "name": "busybox",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "busybox",
      "prefixArgs": []
    },
    {
      "name": "base64",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "base64",
      "prefixArgs": []
    },
    {
      "name": "basename",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "basename",
      "prefixArgs": []
    },
    {
      "name": "cat",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "cat",
      "prefixArgs": []
    },
    {
      "name": "cmp",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "cmp",
      "prefixArgs": []
    },
    {
      "name": "cp",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "cp",
      "prefixArgs": []
    },
    {
      "name": "cut",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "cut",
      "prefixArgs": []
    },
    {
      "name": "diff",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "diff",
      "prefixArgs": []
    },
    {
      "name": "dirname",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "dirname",
      "prefixArgs": []
    },
    {
      "name": "echo",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "echo",
      "prefixArgs": []
    },
    {
      "name": "false",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "false",
      "prefixArgs": []
    },
    {
      "name": "find",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "find",
      "prefixArgs": []
    },
    {
      "name": "grep",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "grep",
      "prefixArgs": []
    },
    {
      "name": "gunzip",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "gunzip",
      "prefixArgs": []
    },
    {
      "name": "gzip",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "gzip",
      "prefixArgs": []
    },
    {
      "name": "head",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "head",
      "prefixArgs": []
    },
    {
      "name": "hexdump",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "hexdump",
      "prefixArgs": []
    },
    {
      "name": "ln",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "ln",
      "prefixArgs": []
    },
    {
      "name": "ls",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "ls",
      "prefixArgs": []
    },
    {
      "name": "mkdir",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "mkdir",
      "prefixArgs": []
    },
    {
      "name": "mv",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "mv",
      "prefixArgs": []
    },
    {
      "name": "od",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "od",
      "prefixArgs": []
    },
    {
      "name": "printf",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "printf",
      "prefixArgs": []
    },
    {
      "name": "pwd",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "pwd",
      "prefixArgs": []
    },
    {
      "name": "readlink",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "readlink",
      "prefixArgs": []
    },
    {
      "name": "realpath",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "realpath",
      "prefixArgs": []
    },
    {
      "name": "rm",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "rm",
      "prefixArgs": []
    },
    {
      "name": "rmdir",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "rmdir",
      "prefixArgs": []
    },
    {
      "name": "sed",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "sed",
      "prefixArgs": []
    },
    {
      "name": "sha256sum",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "sha256sum",
      "prefixArgs": []
    },
    {
      "name": "sort",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "sort",
      "prefixArgs": []
    },
    {
      "name": "stat",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "stat",
      "prefixArgs": []
    },
    {
      "name": "tail",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "tail",
      "prefixArgs": []
    },
    {
      "name": "tar",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "tar",
      "prefixArgs": []
    },
    {
      "name": "tee",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "tee",
      "prefixArgs": []
    },
    {
      "name": "touch",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "touch",
      "prefixArgs": []
    },
    {
      "name": "tr",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "tr",
      "prefixArgs": []
    },
    {
      "name": "true",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "true",
      "prefixArgs": []
    },
    {
      "name": "uniq",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "uniq",
      "prefixArgs": []
    },
    {
      "name": "unzip",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "unzip",
      "prefixArgs": []
    },
    {
      "name": "wc",
      "package": "busybox",
      "adapter": "wasi-preview1-live",
      "path": "bin/busybox",
      "argv0": "wc",
      "prefixArgs": []
    },
    {
      "name": "clang",
      "package": "llvm",
      "adapter": "llvm-clang-tool-host-live-v1",
      "path": "bin/llvm",
      "argv0": "/opt/toolchains/llvm/bin/llvm",
      "prefixArgs": [
        "clang",
        "--target=wasm32-wasi",
        "-fuse-ld=/opt/toolchains/llvm/bin/wasm-ld",
        "--sysroot=/usr/share/wasm-sysroot",
        "-resource-dir=/usr/share/wasm-sysroot/lib/clang/22",
        "-Wl,--max-memory=67108864"
      ]
    }
  ],
  "distributionId": "website-bc7a0d3bfe795fb289381d6e2bc7dafd195c2554de11388c99b48d9838b7f7cc"
}
`,manifestSha256:`efb203a625aa7368233da9cae8795e55f673f13932720867510ddc3ad3249636`,assetURLs:[`https://seo-rii.github.io/wasm-idle/container-app/objects/522a8c74c286f6b69256b537a0d3d8a2c17130f4b855ace9605d7434e3414bce/sdk.wasm`,`https://seo-rii.github.io/wasm-idle/container-app/objects/7b96d6c3fba3c6978fa16c0bb523ce76a106ba006e6a9104384ad61336617604/bash.webc.bin`,`https://seo-rii.github.io/wasm-idle/container-app/objects/30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40/busybox.wasm`,`https://seo-rii.github.io/wasm-idle/container-app/objects/eeee4f23e80b03cdd7b98c6722801f6e21143e67d83301a667acc7b70aba31ba/clang.wasm.gz.bin`,`https://seo-rii.github.io/wasm-idle/container-app/objects/dd9279345172fae1aef049ffcaf7531f945d85df08d97ea2ffce90581e9eee2d/lld.wasm.gz.bin`,`https://seo-rii.github.io/wasm-idle/container-app/objects/670cf09dcb37d920f958ae68d0bc6655aba56e63153204239fc517708525f611/sysroot-c.tar.gz.bin`,`https://seo-rii.github.io/wasm-idle/container-app/objects/ee8f1395e7e5281d9e706b67e5b51910cf070730b5e2271aa559336d63968510/sysroot-cxx.tar.gz.bin`],sdkUrl:`./sdk/index.mjs`,sdkWorkerUrl:`./sdk/worker.mjs`,liveWorkerUrl:`./live-worker.mjs`,clangWorkerUrl:`./clang-worker.mjs`,sdkAsset:{packageId:`shell`,assetId:`sdk`},shellAsset:{packageId:`shell`,assetId:`bash`},bashWasmSha256:`b960085bf67b064f73658fb2678f2d9d87eda448a74840d582f1d615f1a94a8f`,memory:{initial:35,maximum:16384,shared:!0},clangSha256:`e0b548b70e13ad9620c1f47a1ef3f552b74cea586866ef1d8dcc0558c87f50e3`,linkerSha256:`3da2fc3d37702d3d56bce834672912334e36d245efaf97fbdda7e4b5e810134a`,cacheNamespace:`container-website`,commandTimeoutMs:24e4,clangFilesystem:`live`,clangModuleServices:!0,sysrootProfile:`c-base-v1`,sysrootLayers:{schemaVersion:1,basePackage:`llvm-sysroot-c`,cxxPackage:`llvm-sysroot-cxx`,full:{bytes:35325440,sha256:`764b95281a33c2492594648a05a5697efa68943f3be158c699193a1767ace756`}}},hostHash:`292fb21466f858200f12b4f59215adc654d4e844c66a08ac9a53d3a6b034000b`,container:{source:`workspace`,profile:`virtual-metadata-v1`,package:`@wasm-idle/container`,version:`0.2.2`,packageJsonSha256:`f3b93b818fbe231e4e2aafc3ddb1614e99a3e87b54f34d9e4509a8e593b2c220`,files:{"dist/index.js":`6a3f1db162cb02ff34783c1d8b338935fa2876ab66774fe6fc7e376b877299f3`,"dist/adapters/wasix/index.js":`43813aa511ff0b78f5342982f27abe69a7e7c8f4a5fa3bf5dfeb08683113f8db`,"dist/adapters/clang/index.js":`e6a9662175670cdf1dcc58afc27620e5848b2e2f899c8667b610027cc47dbb5a`,"dist/adapters/clang-live/index.js":`ab9d38c88f21f7fe4ab013b9828b2e1382b3f8c345cfe177ab0d22149bcc8b15`,"dist/adapters/wasi-live/index.js":`a59b80163c9ce907d2602bc92e708581f147ab5b5da3abce47301b7235cfa088`,"dist/fs/persistence/index.js":`ecfb92ffb4a79dab9f17fe44182a0d9f6523f0dcbbecefd44fd9b64aedcf7cf5`,"dist/workspace/index.js":`ca74765bbdac2827bdcd4992364fe8c5ba316d84c00d280fd4974156375738d9`,"dist/terminal/index.js":`f6afa89b2554b7212ba40630260f6a3c96b41cfda9957ef48239a0a1467a0269`,"dist/adapters/wasi-live/worker.js":`847e8cbed2699ef0bc9f0f2dbc6f4af21a0e01360cb53a8a97c83cdbe4148419`,"dist/adapters/clang-live/worker.js":`71aac77e344fab90c309b4678d63f3733bf57e68f73e5a9666c5baecdead7185`}},baseURL:`https://seo-rii.github.io/wasm-idle/container-app/`};async function Ur(e){let t=new URL(e,globalThis.location.href);if(t.origin!==globalThis.location.origin||!t.pathname.endsWith(`/`)||t.search||t.hash||t.username||t.password)throw Error(`Invalid application asset root`);let n=new URL(`container-app/`,t),r=new URL(Hr.baseURL),i=structuredClone(Hr.distribution);for(let e of i.packages)for(let t of e.assets){let e=new URL(t.url).pathname.slice(r.pathname.length);if(!/^objects\/[a-f0-9]{64}\/[a-z0-9.-]+$/.test(e))throw Error(`Invalid fixed container object`);t.url=new URL(e,n).href}let a=JSON.stringify(i),o=Array.from(new Uint8Array(await crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(a))),e=>e.toString(16).padStart(2,`0`)).join(``),s=new URL(`host/`+Hr.hostHash+`/`,n),c={...Hr.config,manifest:a,manifestSha256:o,assetURLs:i.packages.flatMap(e=>e.assets.map(e=>e.url)),sdkUrl:new URL(`./sdk/index.mjs`,s).href,sdkWorkerUrl:new URL(`./sdk/worker.mjs`,s).href,liveWorkerUrl:new URL(`./live-worker.mjs`,s).href,clangWorkerUrl:new URL(`./clang-worker.mjs`,s).href,commandTimeoutMs:void 0};return{config:c,sdk:await import(
/* @vite-ignore */
c.sdkUrl)}}jr({languages:Vr,createBinding:Pr,createBashConfiguration:Ur,shellCommands:zr});export{re as _,xt as a,Je as c,V as d,Le as f,se as g,le as h,yt as i,Ve as l,pe as m,bt as n,ct as o,B as p,St as r,Xe as s,Sr as t,Ie as u};