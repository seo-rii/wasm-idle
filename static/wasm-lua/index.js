/* wasm-lua browser bundle */
var yr=Object.create;var tt=Object.defineProperty;var kr=Object.getOwnPropertyDescriptor;var Er=Object.getOwnPropertyNames;var Lr=Object.getPrototypeOf,Tr=Object.prototype.hasOwnProperty;var Ln=(f,_,x)=>()=>{if(x)throw x[0];try{return f&&(_=f(f=0)),_}catch(C){throw x=[C],C}};var xr=(f,_)=>()=>{try{return _||f((_={exports:{}}).exports,_),_.exports}catch(x){throw _=0,x}},Tn=(f,_)=>{for(var x in _)tt(f,x,{get:_[x],enumerable:!0})},xn=(f,_,x,C)=>{if(_&&typeof _=="object"||typeof _=="function")for(let U of Er(_))!Tr.call(f,U)&&U!==x&&tt(f,U,{get:()=>_[U],enumerable:!(C=kr(_,U))||C.enumerable});return f};var Sr=(f,_,x)=>(x=f!=null?yr(Lr(f)):{},xn(_||!f||!f.__esModule?tt(x,"default",{value:f,enumerable:!0}):x,f)),nt=f=>xn(tt({},"__esModule",{value:!0}),f);var Ve={};Tn(Ve,{default:()=>Mr,existsSync:()=>Fr,pathToFileURL:()=>Pr,readFileSync:()=>Ar,statSync:()=>Rr});var Or,Mr,Ar,Fr,Rr,Pr,$e=Ln(()=>{Or={},Mr=Or,Ar=()=>{},Fr=()=>!1,Rr=()=>({isFile:()=>!1,isDirectory:()=>!1}),Pr=f=>String(f)});var Sn={};Tn(Sn,{default:()=>Ir,existsSync:()=>Cr,pathToFileURL:()=>Br,readFileSync:()=>Nr,statSync:()=>Ur});var Dr,Ir,Nr,Cr,Ur,Br,On=Ln(()=>{Dr={},Ir=Dr,Nr=()=>{},Cr=()=>!1,Ur=()=>({isFile:()=>!1,isDirectory:()=>!1}),Br=f=>String(f)});var An=xr((rt,Mn)=>{(function(f,_){typeof rt=="object"&&typeof Mn<"u"?_(rt):typeof define=="function"&&define.amd?define(["exports"],_):(f=typeof globalThis<"u"?globalThis:f||self,_(f.wasmoon={}))})(rt,(function(f){"use strict";var _=typeof document<"u"?document.currentScript:null;f.LuaReturn=void 0,(function(g){g[g.Ok=0]="Ok",g[g.Yield=1]="Yield",g[g.ErrorRun=2]="ErrorRun",g[g.ErrorSyntax=3]="ErrorSyntax",g[g.ErrorMem=4]="ErrorMem",g[g.ErrorErr=5]="ErrorErr",g[g.ErrorFile=6]="ErrorFile"})(f.LuaReturn||(f.LuaReturn={}));let x=4,C=-1,U=1e6,j=-U-1e3;f.LuaType=void 0,(function(g){g[g.None=-1]="None",g[g.Nil=0]="Nil",g[g.Boolean=1]="Boolean",g[g.LightUserdata=2]="LightUserdata",g[g.Number=3]="Number",g[g.String=4]="String",g[g.Table=5]="Table",g[g.Function=6]="Function",g[g.Userdata=7]="Userdata",g[g.Thread=8]="Thread"})(f.LuaType||(f.LuaType={})),f.LuaEventCodes=void 0,(function(g){g[g.Call=0]="Call",g[g.Ret=1]="Ret",g[g.Line=2]="Line",g[g.Count=3]="Count",g[g.TailCall=4]="TailCall"})(f.LuaEventCodes||(f.LuaEventCodes={})),f.LuaEventMasks=void 0,(function(g){g[g.Call=1]="Call",g[g.Ret=2]="Ret",g[g.Line=4]="Line",g[g.Count=8]="Count"})(f.LuaEventMasks||(f.LuaEventMasks={})),f.LuaLibraries=void 0,(function(g){g.Base="_G",g.Coroutine="coroutine",g.Table="table",g.IO="io",g.OS="os",g.String="string",g.UTF8="utf8",g.Math="math",g.Debug="debug",g.Package="package"})(f.LuaLibraries||(f.LuaLibraries={}));class ae extends Error{}class H{constructor(n,a){this.target=n,this.options=a}}function K(g,n){return new H(g,n)}class ne extends Number{}class we extends Array{}let Cn=1e3;class ve{constructor(n,a,u,l){this.closed=!1,this.lua=n,this.typeExtensions=a,this.address=u,this.parent=l}newThread(){let n=this.lua.lua_newthread(this.address);if(!n)throw new Error("lua_newthread returned a null pointer");return new ve(this.lua,this.typeExtensions,n,this.parent||this)}resetThread(){this.assertOk(this.lua.lua_resetthread(this.address))}loadString(n,a){let u=this.lua.module.lengthBytesUTF8(n),l=u+1,p=this.lua.module._malloc(l);try{this.lua.module.stringToUTF8(n,p,l),this.assertOk(this.lua.luaL_loadbufferx(this.address,p,u,a??p,null))}finally{this.lua.module._free(p)}}loadFile(n){this.assertOk(this.lua.luaL_loadfilex(this.address,n,null))}resume(n=0){let a=this.lua.module._malloc(x);try{return this.lua.module.setValue(a,0,"i32"),{result:this.lua.lua_resume(this.address,null,n,a),resultCount:this.lua.module.getValue(a,"i32")}}finally{this.lua.module._free(a)}}getTop(){return this.lua.lua_gettop(this.address)}setTop(n){this.lua.lua_settop(this.address,n)}remove(n){return this.lua.lua_remove(this.address,n)}setField(n,a,u){n=this.lua.lua_absindex(this.address,n),this.pushValue(u),this.lua.lua_setfield(this.address,n,a)}async run(n=0,a){let u=this.timeout;try{a?.timeout!==void 0&&this.setTimeout(Date.now()+a.timeout);let l=this.resume(n);for(;l.result===f.LuaReturn.Yield;){if(this.timeout&&Date.now()>this.timeout)throw l.resultCount>0&&this.pop(l.resultCount),new ae("thread timeout exceeded");if(l.resultCount>0){let p=this.getValue(-1);this.pop(l.resultCount),p===Promise.resolve(p)?await p:await new Promise(y=>setImmediate(y))}else await new Promise(p=>setImmediate(p));l=this.resume(0)}return this.assertOk(l.result),this.getStackValues()}finally{a?.timeout!==void 0&&this.setTimeout(u)}}runSync(n=0){let a=this.getTop()-n-1;return this.assertOk(this.lua.lua_pcallk(this.address,n,C,0,0,null)),this.getStackValues(a)}pop(n=1){this.lua.lua_pop(this.address,n)}call(n,...a){let u=this.lua.lua_getglobal(this.address,n);if(u!==f.LuaType.Function)throw new Error(`A function of type '${u}' was pushed, expected is ${f.LuaType.Function}`);for(let p of a)this.pushValue(p);let l=this.getTop()-a.length-1;return this.lua.lua_callk(this.address,a.length,C,0,null),this.getStackValues(l)}getStackValues(n=0){let a=this.getTop()-n,u=new we(a);for(let l=0;l<a;l++)u[l]=this.getValue(n+l+1);return u}stateToThread(n){var a;return n===((a=this.parent)===null||a===void 0?void 0:a.address)?this.parent:new ve(this.lua,this.typeExtensions,n,this.parent||this)}pushValue(n,a){let u=this.getValueDecorations(n),l=u.target;if(l instanceof ve){this.lua.lua_pushthread(l.address)===1||this.lua.lua_xmove(l.address,this.address,1);return}let p=this.getTop();switch(typeof l){case"undefined":this.lua.lua_pushnil(this.address);break;case"number":Number.isInteger(l)?this.lua.lua_pushinteger(this.address,BigInt(l)):this.lua.lua_pushnumber(this.address,l);break;case"string":this.lua.lua_pushstring(this.address,l);break;case"boolean":this.lua.lua_pushboolean(this.address,l?1:0);break;default:if(!this.typeExtensions.find(y=>y.extension.pushValue(this,u,a)))throw new Error(`The type '${typeof l}' is not supported by Lua`)}if(u.options.metatable&&this.setMetatable(-1,u.options.metatable),this.getTop()!==p+1)throw new Error(`pushValue expected stack size ${p+1}, got ${this.getTop()}`)}setMetatable(n,a){if(n=this.lua.lua_absindex(this.address,n),this.lua.lua_getmetatable(this.address,n)){this.pop(1);let u=this.getMetatableName(n);throw new Error(`data already has associated metatable: ${u||"unknown name"}`)}this.pushValue(a),this.lua.lua_setmetatable(this.address,n)}getMetatableName(n){let a=this.lua.luaL_getmetafield(this.address,n,"__name");if(a===f.LuaType.Nil)return;if(a!==f.LuaType.String){this.pop(1);return}let u=this.lua.lua_tolstring(this.address,-1,null);return this.pop(1),u}getValue(n,a,u){n=this.lua.lua_absindex(this.address,n);let l=a??this.lua.lua_type(this.address,n);switch(l){case f.LuaType.None:return;case f.LuaType.Nil:return null;case f.LuaType.Number:return this.lua.lua_tonumberx(this.address,n,null);case f.LuaType.String:return this.lua.lua_tolstring(this.address,n,null);case f.LuaType.Boolean:return!!this.lua.lua_toboolean(this.address,n);case f.LuaType.Thread:return this.stateToThread(this.lua.lua_tothread(this.address,n));default:{let p;(l===f.LuaType.Table||l===f.LuaType.Userdata)&&(p=this.getMetatableName(n));let y=this.typeExtensions.find(M=>M.extension.isType(this,n,l,p));return y?y.extension.getValue(this,n,u):(console.warn(`The type '${this.lua.lua_typename(this.address,l)}' returned is not supported on JS`),new ne(this.lua.lua_topointer(this.address,n)))}}}close(){this.isClosed()||(this.hookFunctionPointer&&this.lua.module.removeFunction(this.hookFunctionPointer),this.closed=!0)}setTimeout(n){n&&n>0?(this.hookFunctionPointer||(this.hookFunctionPointer=this.lua.module.addFunction(()=>{Date.now()>n&&(this.pushValue(new ae("thread timeout exceeded")),this.lua.lua_error(this.address))},"vii")),this.lua.lua_sethook(this.address,this.hookFunctionPointer,f.LuaEventMasks.Count,Cn),this.timeout=n):this.hookFunctionPointer&&(this.hookFunctionPointer=void 0,this.timeout=void 0,this.lua.lua_sethook(this.address,null,0,0))}getTimeout(){return this.timeout}getPointer(n){return new ne(this.lua.lua_topointer(this.address,n))}isClosed(){var n;return!this.address||this.closed||!!(!((n=this.parent)===null||n===void 0)&&n.isClosed())}indexToString(n){let a=this.lua.luaL_tolstring(this.address,n,null);return this.pop(),a}dumpStack(n=console.log){let a=this.getTop();for(let u=1;u<=a;u++){let l=this.lua.lua_type(this.address,u),p=this.lua.lua_typename(this.address,l),y=this.getPointer(u),M=this.indexToString(u),L=this.getValue(u,l);n(u,p,y,M,L)}}assertOk(n){if(n!==f.LuaReturn.Ok&&n!==f.LuaReturn.Yield){let a=f.LuaReturn[n],u=new Error(`Lua Error(${a}/${n})`);if(this.getTop()>0)if(n===f.LuaReturn.ErrorMem)u.message=this.lua.lua_tolstring(this.address,-1,null);else{let l=this.getValue(-1);l instanceof Error&&(u.stack=l.stack),u.message=this.indexToString(-1)}if(n!==f.LuaReturn.ErrorMem)try{this.lua.luaL_traceback(this.address,this.address,null,1);let l=this.lua.lua_tolstring(this.address,-1,null);l.trim()!=="stack traceback:"&&(u.message=`${u.message}
${l}`),this.pop(1)}catch(l){console.warn("Failed to generate stack trace",l)}throw u}}getValueDecorations(n){return n instanceof H?n:new H(n,{})}}class Pt extends ve{constructor(n,a){if(a){let u={memoryUsed:0},l=n.module.addFunction((y,M,L,D)=>{if(D===0)return M&&(u.memoryUsed-=L,n.module._free(M)),0;let P=M?D-L:D,N=u.memoryUsed+P;if(D>L&&u.memoryMax&&N>u.memoryMax)return 0;let V=n.module._realloc(M,D);return V&&(u.memoryUsed=N),V},"iiiii"),p=n.lua_newstate(l,null);if(!p)throw n.module.removeFunction(l),new Error("lua_newstate returned a null pointer");super(n,[],p),this.memoryStats=u,this.allocatorFunctionPointer=l}else super(n,[],n.luaL_newstate());if(this.isClosed())throw new Error("Global state could not be created (probably due to lack of memory)")}close(){if(!this.isClosed()){super.close(),this.lua.lua_close(this.address),this.allocatorFunctionPointer&&this.lua.module.removeFunction(this.allocatorFunctionPointer);for(let n of this.typeExtensions)n.extension.close()}}registerTypeExtension(n,a){this.typeExtensions.push({extension:a,priority:n}),this.typeExtensions.sort((u,l)=>l.priority-u.priority)}loadLibrary(n){switch(n){case f.LuaLibraries.Base:this.lua.luaopen_base(this.address);break;case f.LuaLibraries.Coroutine:this.lua.luaopen_coroutine(this.address);break;case f.LuaLibraries.Table:this.lua.luaopen_table(this.address);break;case f.LuaLibraries.IO:this.lua.luaopen_io(this.address);break;case f.LuaLibraries.OS:this.lua.luaopen_os(this.address);break;case f.LuaLibraries.String:this.lua.luaopen_string(this.address);break;case f.LuaLibraries.UTF8:this.lua.luaopen_string(this.address);break;case f.LuaLibraries.Math:this.lua.luaopen_math(this.address);break;case f.LuaLibraries.Debug:this.lua.luaopen_debug(this.address);break;case f.LuaLibraries.Package:this.lua.luaopen_package(this.address);break}this.lua.lua_setglobal(this.address,n)}get(n){let a=this.lua.lua_getglobal(this.address,n),u=this.getValue(-1,a);return this.pop(),u}set(n,a){this.pushValue(a),this.lua.lua_setglobal(this.address,n)}getTable(n,a){let u=this.getTop(),l=this.lua.lua_getglobal(this.address,n);try{if(l!==f.LuaType.Table)throw new TypeError(`Unexpected type in ${n}. Expected ${f.LuaType[f.LuaType.Table]}. Got ${f.LuaType[l]}.`);a(u+1)}finally{this.getTop()!==u+1&&console.warn(`getTable: expected stack size ${u} got ${this.getTop()}`),this.setTop(u)}}getMemoryUsed(){return this.getMemoryStatsRef().memoryUsed}getMemoryMax(){return this.getMemoryStatsRef().memoryMax}setMemoryMax(n){this.getMemoryStatsRef().memoryMax=n}getMemoryStatsRef(){if(!this.memoryStats)throw new Error("Memory allocations is not being traced, please build engine with { traceAllocations: true }");return this.memoryStats}}class ue{constructor(n,a){this.thread=n,this.name=a}isType(n,a,u,l){return u===f.LuaType.Userdata&&l===this.name}getValue(n,a,u){let l=n.lua.luaL_testudata(n.address,a,this.name);if(!l)throw new Error(`data does not have the expected metatable: ${this.name}`);let p=n.lua.module.getValue(l,"*");return n.lua.getRef(p)}pushValue(n,a,u){let{target:l}=a,p=n.lua.ref(l),y=n.lua.lua_newuserdatauv(n.address,x,0);if(n.lua.module.setValue(y,p,"*"),f.LuaType.Nil===n.lua.luaL_getmetatable(n.address,this.name))throw n.pop(2),new Error(`metatable not found: ${this.name}`);return n.lua.lua_setmetatable(n.address,-2),!0}}class Un extends ue{constructor(n,a){if(super(n,"js_error"),this.gcPointer=n.lua.module.addFunction(u=>{let l=n.lua.luaL_checkudata(u,1,this.name),p=n.lua.module.getValue(l,"*");return n.lua.unref(p),f.LuaReturn.Ok},"ii"),n.lua.luaL_newmetatable(n.address,this.name)){let u=n.lua.lua_gettop(n.address);n.lua.lua_pushstring(n.address,"protected metatable"),n.lua.lua_setfield(n.address,u,"__metatable"),n.lua.lua_pushcclosure(n.address,this.gcPointer,0),n.lua.lua_setfield(n.address,u,"__gc"),n.pushValue((l,p)=>p==="message"?l.message:null),n.lua.lua_setfield(n.address,u,"__index"),n.pushValue(l=>l.message),n.lua.lua_setfield(n.address,u,"__tostring")}n.lua.lua_pop(n.address,1),a&&n.set("Error",{create:u=>{if(u&&typeof u!="string")throw new Error("message must be a string");return new Error(u)}})}pushValue(n,a){return a.target instanceof Error?super.pushValue(n,a):!1}close(){this.thread.lua.module.removeFunction(this.gcPointer)}}function Bn(g,n){return new Un(g,n)}class je{constructor(n){this.count=n}}function at(g,n){return new H(g,n)}class zn extends ue{constructor(n,a){super(n,"js_function"),this.functionRegistry=typeof FinalizationRegistry<"u"?new FinalizationRegistry(u=>{this.thread.isClosed()||this.thread.lua.luaL_unref(this.thread.address,j,u)}):void 0,this.options=a,this.callbackContext=n.newThread(),this.callbackContextIndex=this.thread.lua.luaL_ref(n.address,j),this.functionRegistry||console.warn("FunctionTypeExtension: FinalizationRegistry not found. Memory leaks likely."),this.gcPointer=n.lua.module.addFunction(u=>{n.lua.luaL_checkudata(u,1,this.name);let l=n.lua.luaL_checkudata(u,1,this.name),p=n.lua.module.getValue(l,"*");return n.lua.unref(p),f.LuaReturn.Ok},"ii"),n.lua.luaL_newmetatable(n.address,this.name)&&(n.lua.lua_pushstring(n.address,"__gc"),n.lua.lua_pushcclosure(n.address,this.gcPointer,0),n.lua.lua_settable(n.address,-3),n.lua.lua_pushstring(n.address,"__metatable"),n.lua.lua_pushstring(n.address,"protected metatable"),n.lua.lua_settable(n.address,-3)),n.lua.lua_pop(n.address,1),this.functionWrapper=n.lua.module.addFunction(u=>{let l=n.stateToThread(u),p=n.lua.luaL_checkudata(u,n.lua.lua_upvalueindex(1),this.name),y=n.lua.module.getValue(p,"*"),{target:M,options:L}=n.lua.getRef(y),D=l.getTop(),P=[];if(L.receiveThread&&P.push(l),L.receiveArgsQuantity)P.push(D);else for(let N=1;N<=D;N++){let V=l.getValue(N);(N!==1||!L?.self||V!==L.self)&&P.push(V)}try{let N=M.apply(L?.self,P);if(N===void 0)return 0;if(N instanceof je)return N.count;if(N instanceof we){for(let V of N)l.pushValue(V);return N.length}else return l.pushValue(N),1}catch(N){if(N===1/0)throw N;return l.pushValue(N),l.lua.lua_error(l.address)}},"ii")}close(){this.thread.lua.module.removeFunction(this.gcPointer),this.thread.lua.module.removeFunction(this.functionWrapper),this.callbackContext.close(),this.callbackContext.lua.luaL_unref(this.callbackContext.address,j,this.callbackContextIndex)}isType(n,a,u){return u===f.LuaType.Function}pushValue(n,a){if(typeof a.target!="function")return!1;let u=n.lua.ref(a),l=n.lua.lua_newuserdatauv(n.address,x,0);if(n.lua.module.setValue(l,u,"*"),f.LuaType.Nil===n.lua.luaL_getmetatable(n.address,this.name))throw n.pop(1),n.lua.unref(u),new Error(`metatable not found: ${this.name}`);return n.lua.lua_setmetatable(n.address,-2),n.lua.lua_pushcclosure(n.address,this.functionWrapper,1),!0}getValue(n,a){var u;n.lua.lua_pushvalue(n.address,a);let l=n.lua.luaL_ref(n.address,j),p=(...y)=>{var M;if(this.callbackContext.isClosed()){console.warn("Tried to call a function after closing lua state");return}let L=this.callbackContext.newThread();try{let D=L.lua.lua_rawgeti(L.address,j,BigInt(l));if(D!==f.LuaType.Function){let N=L.lua.luaL_getmetafield(L.address,-1,"__call");if(L.pop(),N!==f.LuaType.Function)throw new Error(`A value of type '${D}' was pushed but it is not callable`)}for(let N of y)L.pushValue(N);!((M=this.options)===null||M===void 0)&&M.functionTimeout&&L.setTimeout(Date.now()+this.options.functionTimeout);let P=L.lua.lua_pcallk(L.address,y.length,1,0,0,null);if(P===f.LuaReturn.Yield)throw new Error("cannot yield in callbacks from javascript");return L.assertOk(P),L.getTop()>0?L.getValue(-1):void 0}finally{L.close(),this.callbackContext.pop()}};return(u=this.functionRegistry)===null||u===void 0||u.register(p,l),p}}function Vn(g,n){return new zn(g,n)}class $n extends ue{constructor(n){if(super(n,"js_null"),this.gcPointer=n.lua.module.addFunction(a=>{let u=n.lua.luaL_checkudata(a,1,this.name),l=n.lua.module.getValue(u,"*");return n.lua.unref(l),f.LuaReturn.Ok},"ii"),n.lua.luaL_newmetatable(n.address,this.name)){let a=n.lua.lua_gettop(n.address);n.lua.lua_pushstring(n.address,"protected metatable"),n.lua.lua_setfield(n.address,a,"__metatable"),n.lua.lua_pushcclosure(n.address,this.gcPointer,0),n.lua.lua_setfield(n.address,a,"__gc"),n.pushValue(()=>null),n.lua.lua_setfield(n.address,a,"__index"),n.pushValue(()=>"null"),n.lua.lua_setfield(n.address,a,"__tostring"),n.pushValue((u,l)=>u===l),n.lua.lua_setfield(n.address,a,"__eq")}n.lua.lua_pop(n.address,1),super.pushValue(n,new H({},{})),n.lua.lua_setglobal(n.address,"null")}getValue(n,a){if(!n.lua.luaL_testudata(n.address,a,this.name))throw new Error(`data does not have the expected metatable: ${this.name}`);return null}pushValue(n,a){return a?.target!==null?!1:(n.lua.lua_getglobal(n.address,"null"),!0)}close(){this.thread.lua.module.removeFunction(this.gcPointer)}}function jn(g){return new $n(g)}class Hn extends ue{constructor(n,a){if(super(n,"js_promise"),this.gcPointer=n.lua.module.addFunction(u=>{let l=n.lua.luaL_checkudata(u,1,this.name),p=n.lua.module.getValue(l,"*");return n.lua.unref(p),f.LuaReturn.Ok},"ii"),n.lua.luaL_newmetatable(n.address,this.name)){let u=n.lua.lua_gettop(n.address);n.lua.lua_pushstring(n.address,"protected metatable"),n.lua.lua_setfield(n.address,u,"__metatable"),n.lua.lua_pushcclosure(n.address,this.gcPointer,0),n.lua.lua_setfield(n.address,u,"__gc");let l=p=>{if(Promise.resolve(p)!==p&&typeof p.then!="function")throw new Error("promise method called without self instance");return!0};n.pushValue({next:(p,...y)=>l(p)&&p.then(...y),catch:(p,...y)=>l(p)&&p.catch(...y),finally:(p,...y)=>l(p)&&p.finally(...y),await:at((p,y)=>{if(l(y),p.address===n.address)throw new Error("cannot await in the main thread");let M,L=y.then(P=>{M={status:"fulfilled",value:P}}).catch(P=>{M={status:"rejected",value:P}}),D=this.thread.lua.module.addFunction(P=>{if(!M)return n.lua.lua_yieldk(p.address,0,0,D);this.thread.lua.module.removeFunction(D);let N=n.stateToThread(P);if(M.status==="rejected")return N.pushValue(M.value||new Error("promise rejected with no error")),this.thread.lua.lua_error(P);if(M.value instanceof je)return M.value.count;if(M.value instanceof we){for(let V of M.value)N.pushValue(V);return M.value.length}else return N.pushValue(M.value),1},"iiii");return p.pushValue(L),new je(n.lua.lua_yieldk(p.address,1,0,D))},{receiveThread:!0})}),n.lua.lua_setfield(n.address,u,"__index"),n.pushValue((p,y)=>p===y),n.lua.lua_setfield(n.address,u,"__eq")}n.lua.lua_pop(n.address,1),a&&n.set("Promise",{create:u=>new Promise(u),all:u=>{if(!Array.isArray(u))throw new Error("argument must be an array of promises");return Promise.all(u.map(l=>Promise.resolve(l)))},resolve:u=>Promise.resolve(u)})}close(){this.thread.lua.module.removeFunction(this.gcPointer)}pushValue(n,a){return Promise.resolve(a.target)!==a.target&&typeof a.target.then!="function"?!1:super.pushValue(n,a)}}function qn(g,n){return new Hn(g,n)}function Dt(g,n){return new H(g,n||{})}class Wn extends ue{constructor(n){if(super(n,"js_proxy"),this.gcPointer=n.lua.module.addFunction(a=>{let u=n.lua.luaL_checkudata(a,1,this.name),l=n.lua.module.getValue(u,"*");return n.lua.unref(l),f.LuaReturn.Ok},"ii"),n.lua.luaL_newmetatable(n.address,this.name)){let a=n.lua.lua_gettop(n.address);n.lua.lua_pushstring(n.address,"protected metatable"),n.lua.lua_setfield(n.address,a,"__metatable"),n.lua.lua_pushcclosure(n.address,this.gcPointer,0),n.lua.lua_setfield(n.address,a,"__gc"),n.pushValue((u,l)=>{switch(typeof l){case"number":l=l-1;case"string":break;default:throw new Error("Only strings or numbers can index js objects")}let p=u[l];return typeof p=="function"?at(p,{self:u}):p}),n.lua.lua_setfield(n.address,a,"__index"),n.pushValue((u,l,p)=>{switch(typeof l){case"number":l=l-1;case"string":break;default:throw new Error("Only strings or numbers can index js objects")}u[l]=p}),n.lua.lua_setfield(n.address,a,"__newindex"),n.pushValue(u=>{var l,p;return(p=(l=u.toString)===null||l===void 0?void 0:l.call(u))!==null&&p!==void 0?p:typeof u}),n.lua.lua_setfield(n.address,a,"__tostring"),n.pushValue(u=>u.length||0),n.lua.lua_setfield(n.address,a,"__len"),n.pushValue(u=>{let l=Object.getOwnPropertyNames(u),p=0;return we.of(()=>{let y=we.of(l[p],u[l[p]]);return p++,y},u,null)}),n.lua.lua_setfield(n.address,a,"__pairs"),n.pushValue((u,l)=>u===l),n.lua.lua_setfield(n.address,a,"__eq"),n.pushValue((u,...l)=>(l[0]===u&&l.shift(),u(...l))),n.lua.lua_setfield(n.address,a,"__call")}n.lua.lua_pop(n.address,1)}isType(n,a,u,l){return u===f.LuaType.Userdata&&l===this.name}getValue(n,a){let u=n.lua.lua_touserdata(n.address,a),l=n.lua.module.getValue(u,"*");return n.lua.getRef(l)}pushValue(n,a){var u;let{target:l,options:p}=a;if(p.proxy===void 0){if(l==null||typeof l!="object"&&!(typeof l=="function"&&((u=l.prototype)===null||u===void 0?void 0:u.constructor)===l&&l.toString().startsWith("class "))||Promise.resolve(l)===l||typeof l.then=="function")return!1}else if(p.proxy===!1)return!1;return p.metatable&&!(p.metatable instanceof H)?(a.options.metatable=Dt(p.metatable,{proxy:!1}),!1):super.pushValue(n,a)}close(){this.thread.lua.module.removeFunction(this.gcPointer)}}function Yn(g){return new Wn(g)}class Gn extends ue{constructor(n){super(n,"js_table")}close(){}isType(n,a,u){return u===f.LuaType.Table}getValue(n,a,u){let l=u||new Map,p=n.lua.lua_topointer(n.address,a),y=l.get(p);if(!y){let M=this.readTableKeys(n,a);y=M.length>0&&M.every((D,P)=>D===String(P+1))?[]:{},l.set(p,y),this.readTableValues(n,a,l,y)}return y}pushValue(n,{target:a},u){if(typeof a!="object"||a===null)return!1;let l=u||new Map,p=l.get(a);if(p!==void 0)return n.lua.lua_rawgeti(n.address,j,BigInt(p)),!0;try{let y=n.getTop()+1,M=(L,D)=>{n.lua.lua_createtable(n.address,L,D);let P=n.lua.luaL_ref(n.address,j);l.set(a,P),n.lua.lua_rawgeti(n.address,j,BigInt(P))};if(Array.isArray(a)){M(a.length,0);for(let L=0;L<a.length;L++)n.pushValue(L+1,l),n.pushValue(a[L],l),n.lua.lua_settable(n.address,y)}else{M(0,Object.getOwnPropertyNames(a).length);for(let L in a)n.pushValue(L,l),n.pushValue(a[L],l),n.lua.lua_settable(n.address,y)}}finally{if(u===void 0)for(let y of l.values())n.lua.luaL_unref(n.address,j,y)}return!0}readTableKeys(n,a){let u=[];for(n.lua.lua_pushnil(n.address);n.lua.lua_next(n.address,a);){let l=n.indexToString(-2);u.push(l),n.pop()}return u}readTableValues(n,a,u,l){let p=Array.isArray(l);for(n.lua.lua_pushnil(n.address);n.lua.lua_next(n.address,a);){let y=n.indexToString(-2),M=n.getValue(-1,void 0,u);p?l.push(M):l[y]=M,n.pop()}}}function Kn(g){return new Gn(g)}function Xn(g){return new H(g,{reference:!0})}class Jn extends ue{constructor(n){if(super(n,"js_userdata"),this.gcPointer=n.lua.module.addFunction(a=>{let u=n.lua.luaL_checkudata(a,1,this.name),l=n.lua.module.getValue(u,"*");return n.lua.unref(l),f.LuaReturn.Ok},"ii"),n.lua.luaL_newmetatable(n.address,this.name)){let a=n.lua.lua_gettop(n.address);n.lua.lua_pushstring(n.address,"protected metatable"),n.lua.lua_setfield(n.address,a,"__metatable"),n.lua.lua_pushcclosure(n.address,this.gcPointer,0),n.lua.lua_setfield(n.address,a,"__gc")}n.lua.lua_pop(n.address,1)}isType(n,a,u,l){return u===f.LuaType.Userdata&&l===this.name}getValue(n,a){let u=n.lua.lua_touserdata(n.address,a),l=n.lua.module.getValue(u,"*");return n.lua.getRef(l)}pushValue(n,a){return a.options.reference?super.pushValue(n,a):!1}close(){this.thread.lua.module.removeFunction(this.gcPointer)}}function Zn(g){return new Jn(g)}class It{constructor(n,{openStandardLibs:a=!0,injectObjects:u=!1,enableProxy:l=!0,traceAllocations:p=!1,functionTimeout:y=void 0}={}){this.cmodule=n,this.global=new Pt(this.cmodule,p),this.global.registerTypeExtension(0,Kn(this.global)),this.global.registerTypeExtension(0,Vn(this.global,{functionTimeout:y})),this.global.registerTypeExtension(1,qn(this.global,u)),u&&this.global.registerTypeExtension(5,jn(this.global)),l?this.global.registerTypeExtension(3,Yn(this.global)):this.global.registerTypeExtension(1,Bn(this.global,u)),this.global.registerTypeExtension(4,Zn(this.global)),a&&this.cmodule.luaL_openlibs(this.global.address)}doString(n){return this.callByteCode(a=>a.loadString(n))}doFile(n){return this.callByteCode(a=>a.loadFile(n))}doStringSync(n){return this.global.loadString(n),this.global.runSync()[0]}doFileSync(n){return this.global.loadFile(n),this.global.runSync()[0]}async callByteCode(n){let a=this.global.newThread(),u=this.global.getTop();try{n(a);let l=await a.run(0);return l.length>0?(this.cmodule.lua_xmove(a.address,this.global.address,l.length),this.global.getValue(this.global.getTop()-l.length+1)):void 0}finally{this.global.remove(u)}}}var Qn=(()=>{var g=typeof document>"u"&&typeof location>"u"?($e(),nt(Ve)).pathToFileURL(__filename).href:typeof document>"u"?location.href:_&&_.src||new URL("index.js",document.baseURI).href;return(async function(n={}){var a=n,u,l;a.ready=new Promise((e,t)=>{u=e,l=t}),"_malloc _free _realloc _luaL_checkversion_ _luaL_getmetafield _luaL_callmeta _luaL_tolstring _luaL_argerror _luaL_typeerror _luaL_checklstring _luaL_optlstring _luaL_checknumber _luaL_optnumber _luaL_checkinteger _luaL_optinteger _luaL_checkstack _luaL_checktype _luaL_checkany _luaL_newmetatable _luaL_setmetatable _luaL_testudata _luaL_checkudata _luaL_where _luaL_fileresult _luaL_execresult _luaL_ref _luaL_unref _luaL_loadfilex _luaL_loadbufferx _luaL_loadstring _luaL_newstate _luaL_len _luaL_addgsub _luaL_gsub _luaL_setfuncs _luaL_getsubtable _luaL_traceback _luaL_requiref _luaL_buffinit _luaL_prepbuffsize _luaL_addlstring _luaL_addstring _luaL_addvalue _luaL_pushresult _luaL_pushresultsize _luaL_buffinitsize _lua_newstate _lua_close _lua_newthread _lua_resetthread _lua_atpanic _lua_version _lua_absindex _lua_gettop _lua_settop _lua_pushvalue _lua_rotate _lua_copy _lua_checkstack _lua_xmove _lua_isnumber _lua_isstring _lua_iscfunction _lua_isinteger _lua_isuserdata _lua_type _lua_typename _lua_tonumberx _lua_tointegerx _lua_toboolean _lua_tolstring _lua_rawlen _lua_tocfunction _lua_touserdata _lua_tothread _lua_topointer _lua_arith _lua_rawequal _lua_compare _lua_pushnil _lua_pushnumber _lua_pushinteger _lua_pushlstring _lua_pushstring _lua_pushcclosure _lua_pushboolean _lua_pushlightuserdata _lua_pushthread _lua_getglobal _lua_gettable _lua_getfield _lua_geti _lua_rawget _lua_rawgeti _lua_rawgetp _lua_createtable _lua_newuserdatauv _lua_getmetatable _lua_getiuservalue _lua_setglobal _lua_settable _lua_setfield _lua_seti _lua_rawset _lua_rawseti _lua_rawsetp _lua_setmetatable _lua_setiuservalue _lua_callk _lua_pcallk _lua_load _lua_dump _lua_yieldk _lua_resume _lua_status _lua_isyieldable _lua_setwarnf _lua_warning _lua_error _lua_next _lua_concat _lua_len _lua_stringtonumber _lua_getallocf _lua_setallocf _lua_toclose _lua_closeslot _lua_getstack _lua_getinfo _lua_getlocal _lua_setlocal _lua_getupvalue _lua_setupvalue _lua_upvalueid _lua_upvaluejoin _lua_sethook _lua_gethook _lua_gethookmask _lua_gethookcount _lua_setcstacklimit _luaopen_base _luaopen_coroutine _luaopen_table _luaopen_io _luaopen_os _luaopen_string _luaopen_utf8 _luaopen_math _luaopen_debug _luaopen_package _luaL_openlibs _memory ___indirect_function_table _fflush onRuntimeInitialized".split(" ").forEach(e=>{Object.getOwnPropertyDescriptor(a.ready,e)||Object.defineProperty(a.ready,e,{get:()=>$("You are getting "+e+" on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js"),set:()=>$("You are setting "+e+" on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js")})});var p=Object.assign({},a),y="./this.program",M=(e,t)=>{throw t},L=typeof window=="object",D=typeof importScripts=="function",P=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string",N=!L&&!P&&!D;if(a.ENVIRONMENT)throw Error("Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)");var V="",ye,ke,Ee;if(P){if(typeof process>"u"||!process.release||process.release.name!=="node")throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");var Nt=process.versions.node,Pe=Nt.split(".").slice(0,3);if(Pe=1e4*Pe[0]+100*Pe[1]+1*Pe[2].split("-")[0],16e4>Pe)throw Error("This emscripten-generated code requires node v16.0.0 (detected v"+Nt+")");let{createRequire:e}=await Promise.resolve().then(()=>(On(),Sn));var Le=e(typeof document>"u"&&typeof location>"u"?($e(),nt(Ve)).pathToFileURL(__filename).href:typeof document>"u"?location.href:_&&_.src||new URL("index.js",document.baseURI).href),ot=Le("fs"),st=Le("path");D?V=st.dirname(V)+"/":V=Le("url").fileURLToPath(new URL("./",typeof document>"u"&&typeof location>"u"?($e(),nt(Ve)).pathToFileURL(__filename).href:typeof document>"u"?location.href:_&&_.src||new URL("index.js",document.baseURI).href)),ye=(t,r)=>(t=Ue(t)?new URL(t):st.normalize(t),ot.readFileSync(t,r?void 0:"utf8")),Ee=t=>(t=ye(t,!0),t.buffer||(t=new Uint8Array(t)),b(t.buffer),t),ke=(t,r,o,i=!0)=>{t=Ue(t)?new URL(t):st.normalize(t),ot.readFile(t,i?void 0:"utf8",(c,m)=>{c?o(c):r(i?m.buffer:m)})},!a.thisProgram&&1<process.argv.length&&(y=process.argv[1].replace(/\\/g,"/")),process.argv.slice(2),M=(t,r)=>{throw process.exitCode=t,r},a.inspect=()=>"[Emscripten Module object]"}else if(N){if(typeof process=="object"&&typeof Le=="function"||typeof window=="object"||typeof importScripts=="function")throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");typeof read<"u"&&(ye=read),Ee=e=>typeof readbuffer=="function"?new Uint8Array(readbuffer(e)):(e=read(e,"binary"),b(typeof e=="object"),e),ke=(e,t)=>{setTimeout(()=>t(Ee(e)))},typeof clearTimeout>"u"&&(globalThis.clearTimeout=()=>{}),typeof setTimeout>"u"&&(globalThis.setTimeout=e=>typeof e=="function"?e():$()),typeof quit=="function"&&(M=(e,t)=>{throw setTimeout(()=>{if(!(t instanceof Kt)){let r=t;t&&typeof t=="object"&&t.stack&&(r=[t,t.stack]),q(`exiting due to exception: ${r}`)}quit(e)}),t}),typeof print<"u"&&(typeof console>"u"&&(console={}),console.log=print,console.warn=console.error=typeof printErr<"u"?printErr:print)}else if(L||D){if(D?V=self.location.href:typeof document<"u"&&document.currentScript&&(V=document.currentScript.src),g&&(V=g),V.indexOf("blob:")!==0?V=V.substr(0,V.replace(/[?#].*/,"").lastIndexOf("/")+1):V="",typeof window!="object"&&typeof importScripts!="function")throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");ye=e=>{var t=new XMLHttpRequest;return t.open("GET",e,!1),t.send(null),t.responseText},D&&(Ee=e=>{var t=new XMLHttpRequest;return t.open("GET",e,!1),t.responseType="arraybuffer",t.send(null),new Uint8Array(t.response)}),ke=(e,t,r)=>{var o=new XMLHttpRequest;o.open("GET",e,!0),o.responseType="arraybuffer",o.onload=()=>{o.status==200||o.status==0&&o.response?t(o.response):r()},o.onerror=r,o.send(null)}}else throw Error("environment detection error");var Te=console.log.bind(console),q=console.error.bind(console);Object.assign(a,p),p=null,T("ENVIRONMENT"),T("GL_MAX_TEXTURE_IMAGE_UNITS"),T("SDL_canPlayWithWebAudio"),T("SDL_numSimultaneouslyQueuedBuffers"),T("INITIAL_MEMORY"),T("wasmMemory"),T("arguments"),T("buffer"),T("canvas"),T("doNotCaptureKeyboard"),T("dynamicLibraries"),T("elementPointerLock"),T("extraStackTrace"),T("forcedAspectRatio"),T("instantiateWasm"),T("keyboardListeningElement"),T("freePreloadedMediaOnUse"),T("loadSplitModule"),T("logReadFiles"),T("mainScriptUrlOrBlob"),T("mem"),T("monitorRunDependencies"),T("noExitRuntime"),T("noInitialRun"),T("onAbort"),T("onCustomMessage"),T("onExit"),T("onFree"),T("onFullScreen"),T("onMalloc"),T("onRealloc"),T("onRuntimeInitialized"),T("postMainLoop"),T("postRun"),T("preInit"),T("preMainLoop"),T("preinitializedWebGLContext"),T("memoryInitializerRequest"),T("preloadPlugins"),T("print"),T("printErr"),T("quit"),T("setStatus"),T("statusMessage"),T("stderr"),T("stdin"),T("stdout"),T("thisProgram"),T("wasm"),T("wasmBinary"),T("websocket"),T("fetchSettings"),oe("arguments","arguments_"),oe("thisProgram","thisProgram"),oe("quit","quit_"),b(typeof a.memoryInitializerPrefixURL>"u","Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead"),b(typeof a.pthreadMainPrefixURL>"u","Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead"),b(typeof a.cdInitializerPrefixURL>"u","Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead"),b(typeof a.filePackagePrefixURL>"u","Module.filePackagePrefixURL option was removed, use Module.locateFile instead"),b(typeof a.read>"u","Module.read option was removed (modify read_ in JS)"),b(typeof a.readAsync>"u","Module.readAsync option was removed (modify readAsync in JS)"),b(typeof a.readBinary>"u","Module.readBinary option was removed (modify readBinary in JS)"),b(typeof a.setWindowTitle>"u","Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)"),b(typeof a.TOTAL_MEMORY>"u","Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY"),oe("asm","wasmExports"),oe("read","read_"),oe("readAsync","readAsync"),oe("readBinary","readBinary"),oe("setWindowTitle","setWindowTitle"),b(!N,"shell environment detected but not enabled at build time.  Add 'shell' to `-sENVIRONMENT` to enable."),oe("wasmBinary","wasmBinary"),typeof WebAssembly!="object"&&$("no native wasm support detected");var De,Ie=!1;function b(e,t){e||$("Assertion failed"+(t?": "+t:""))}var Y,qe,xe,k,z,it,We,lt;function Ct(){var e=De.buffer;a.HEAP8=Y=new Int8Array(e),a.HEAP16=xe=new Int16Array(e),a.HEAPU8=qe=new Uint8Array(e),a.HEAPU16=new Uint16Array(e),a.HEAP32=k=new Int32Array(e),a.HEAPU32=z=new Uint32Array(e),a.HEAPF32=it=new Float32Array(e),a.HEAPF64=lt=new Float64Array(e),a.HEAP64=We=new BigInt64Array(e),a.HEAPU64=new BigUint64Array(e)}b(!a.STACK_SIZE,"STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time"),b(typeof Int32Array<"u"&&typeof Float64Array<"u"&&Int32Array.prototype.subarray!=null&&Int32Array.prototype.set!=null,"JS engine does not provide full typed array support"),b(!a.wasmMemory,"Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally"),b(!a.INITIAL_MEMORY,"Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically");function ut(){if(!Ie){var e=At();e==0&&(e+=4);var t=z[e>>2],r=z[e+4>>2];t==34821223&&r==2310721022||$(`Stack overflow! Stack cookie has been overwritten at ${Be(e)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${Be(r)} ${Be(t)}`),z[0]!=1668509029&&$("Runtime error: The application has corrupted its heap memory area (address zero)!")}}var Ut=new Int16Array(1),Bt=new Int8Array(Ut.buffer);if(Ut[0]=25459,Bt[0]!==115||Bt[1]!==99)throw"Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)";var ct=[],dt=[],zt=[],ft=!1;b(Math.imul,"This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill"),b(Math.fround,"This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill"),b(Math.clz32,"This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill"),b(Math.trunc,"This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");var Ne=0,de=null,Ce=null,Se={};function Vt(e){for(var t=e;;){if(!Se[e])return e;e=t+Math.random()}}function ht(e){Ne++,e?(b(!Se[e]),Se[e]=1,de===null&&typeof setInterval<"u"&&(de=setInterval(()=>{if(Ie)clearInterval(de),de=null;else{var t=!1,r;for(r in Se)t||(t=!0,q("still waiting on run dependencies:")),q(`dependency: ${r}`);t&&q("(end of list)")}},1e4))):q("warning: run dependency added without ID")}function Ye(e){Ne--,e?(b(Se[e]),delete Se[e]):q("warning: run dependency removed without ID"),Ne==0&&(de!==null&&(clearInterval(de),de=null),Ce&&(e=Ce,Ce=null,e()))}function $(e){throw e="Aborted("+e+")",q(e),Ie=!0,e=new WebAssembly.RuntimeError(e),l(e),e}var $t=e=>e.startsWith("data:application/octet-stream;base64,"),Ue=e=>e.startsWith("file://");function d(e){return function(){b(ft,`native function \`${e}\` called before runtime initialization`);var t=be[e];return b(t,`exported native function \`${e}\` not found`),t.apply(null,arguments)}}var ce;if(a.locateFile){if(ce="glue.wasm",!$t(ce)){var jt=ce;ce=a.locateFile?a.locateFile(jt,V):V+jt}}else ce=new URL("glue.wasm",typeof document>"u"&&typeof location>"u"?($e(),nt(Ve)).pathToFileURL(__filename).href:typeof document>"u"?location.href:_&&_.src||new URL("index.js",document.baseURI).href).href;function Ht(e){if(Ee)return Ee(e);throw"both async and sync fetching of the wasm failed"}function nr(e){if(L||D){if(typeof fetch=="function"&&!Ue(e))return fetch(e,{credentials:"same-origin"}).then(t=>{if(!t.ok)throw"failed to load wasm binary file at '"+e+"'";return t.arrayBuffer()}).catch(()=>Ht(e));if(ke)return new Promise((t,r)=>{ke(e,o=>t(new Uint8Array(o)),r)})}return Promise.resolve().then(()=>Ht(e))}function qt(e,t,r){return nr(e).then(o=>WebAssembly.instantiate(o,t)).then(o=>o).then(r,o=>{q(`failed to asynchronously prepare wasm: ${o}`),Ue(ce)&&q(`warning: Loading from a file URI (${ce}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`),$(o)})}function rr(e,t){var r=ce;return typeof WebAssembly.instantiateStreaming!="function"||$t(r)||Ue(r)||P||typeof fetch!="function"?qt(r,e,t):fetch(r,{credentials:"same-origin"}).then(o=>WebAssembly.instantiateStreaming(o,e).then(t,function(i){return q(`wasm streaming compile failed: ${i}`),q("falling back to ArrayBuffer instantiation"),qt(r,e,t)}))}function oe(e,t){Object.getOwnPropertyDescriptor(a,e)||Object.defineProperty(a,e,{configurable:!0,get(){$(`\`Module.${e}\` has been replaced by \`${t}\` (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)`)}})}function T(e){Object.getOwnPropertyDescriptor(a,e)&&$(`\`Module.${e}\` was supplied but \`${e}\` not included in INCOMING_MODULE_JS_API`)}function Wt(e){return e==="FS_createPath"||e==="FS_createDataFile"||e==="FS_createPreloadedFile"||e==="FS_unlink"||e==="addRunDependency"||e==="FS_createLazyFile"||e==="FS_createDevice"||e==="removeRunDependency"}function Yt(e,t){typeof globalThis<"u"&&Object.defineProperty(globalThis,e,{configurable:!0,get(){Oe(`\`${e}\` is not longer defined by emscripten. ${t}`)}})}Yt("buffer","Please use HEAP8.buffer or wasmMemory.buffer"),Yt("asm","Please use wasmExports instead");function Gt(e){Object.getOwnPropertyDescriptor(a,e)||Object.defineProperty(a,e,{configurable:!0,get(){var t=`'${e}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;Wt(e)&&(t+=". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you"),$(t)}})}function Kt(e){this.name="ExitStatus",this.message=`Program terminated with exit(${e})`,this.status=e}var Be=e=>(b(typeof e=="number"),"0x"+(e>>>0).toString(16).padStart(8,"0")),Oe=e=>{mt||={},mt[e]||(mt[e]=1,P&&(e="warning: "+e),q(e))},mt,Xt=(e,t)=>{for(var r=0,o=e.length-1;0<=o;o--){var i=e[o];i==="."?e.splice(o,1):i===".."?(e.splice(o,1),r++):r&&(e.splice(o,1),r--)}if(t)for(;r;r--)e.unshift("..");return e},se=e=>{var t=e.charAt(0)==="/",r=e.substr(-1)==="/";return(e=Xt(e.split("/").filter(o=>!!o),!t).join("/"))||t||(e="."),e&&r&&(e+="/"),(t?"/":"")+e},pt=e=>{var t=/^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(e).slice(1);return e=t[0],t=t[1],!e&&!t?".":(t&&=t.substr(0,t.length-1),e+t)},fe=e=>{if(e==="/")return"/";e=se(e),e=e.replace(/\/$/,"");var t=e.lastIndexOf("/");return t===-1?e:e.substr(t+1)},ar=(e,t)=>se(e+"/"+t),or=()=>{if(typeof crypto=="object"&&typeof crypto.getRandomValues=="function")return r=>crypto.getRandomValues(r);if(P)try{var e=Le("crypto");if(e.randomFillSync)return r=>e.randomFillSync(r);var t=e.randomBytes;return r=>(r.set(t(r.byteLength)),r)}catch{}$("no cryptographic support found for randomDevice. consider polyfilling it if you want to use something insecure like Math.random(), e.g. put this in a --pre-js: var crypto = { getRandomValues: (array) => { for (var i = 0; i < array.length; i++) array[i] = (Math.random()*256)|0 } };")},Jt=e=>(Jt=or())(e);function he(){for(var e="",t=!1,r=arguments.length-1;-1<=r&&!t;r--){if(t=0<=r?arguments[r]:s.cwd(),typeof t!="string")throw new TypeError("Arguments to path.resolve must be strings");if(!t)return"";e=t+"/"+e,t=t.charAt(0)==="/"}return e=Xt(e.split("/").filter(o=>!!o),!t).join("/"),(t?"/":"")+e||"."}var Zt=(e,t)=>{function r(m){for(var w=0;w<m.length&&m[w]==="";w++);for(var F=m.length-1;0<=F&&m[F]==="";F--);return w>F?[]:m.slice(w,F-w+1)}e=he(e).substr(1),t=he(t).substr(1),e=r(e.split("/")),t=r(t.split("/"));for(var o=Math.min(e.length,t.length),i=o,c=0;c<o;c++)if(e[c]!==t[c]){i=c;break}for(o=[],c=i;c<e.length;c++)o.push("..");return o=o.concat(t.slice(i)),o.join("/")},Qt=typeof TextDecoder<"u"?new TextDecoder("utf8"):void 0,Me=(e,t)=>{for(var r=t+NaN,o=t;e[o]&&!(o>=r);)++o;if(16<o-t&&e.buffer&&Qt)return Qt.decode(e.subarray(t,o));for(r="";t<o;){var i=e[t++];if(i&128){var c=e[t++]&63;if((i&224)==192)r+=String.fromCharCode((i&31)<<6|c);else{var m=e[t++]&63;(i&240)==224?i=(i&15)<<12|c<<6|m:((i&248)!=240&&Oe("Invalid UTF-8 leading byte "+Be(i)+" encountered when deserializing a UTF-8 string in wasm memory to a JS string!"),i=(i&7)<<18|c<<12|m<<6|e[t++]&63),65536>i?r+=String.fromCharCode(i):(i-=65536,r+=String.fromCharCode(55296|i>>10,56320|i&1023))}}else r+=String.fromCharCode(i)}return r},gt=[],Ae=e=>{for(var t=0,r=0;r<e.length;++r){var o=e.charCodeAt(r);127>=o?t++:2047>=o?t+=2:55296<=o&&57343>=o?(t+=4,++r):t+=3}return t},_t=(e,t,r,o)=>{if(b(typeof e=="string",`stringToUTF8Array expects a string (got ${typeof e})`),!(0<o))return 0;var i=r;o=r+o-1;for(var c=0;c<e.length;++c){var m=e.charCodeAt(c);if(55296<=m&&57343>=m){var w=e.charCodeAt(++c);m=65536+((m&1023)<<10)|w&1023}if(127>=m){if(r>=o)break;t[r++]=m}else{if(2047>=m){if(r+1>=o)break;t[r++]=192|m>>6}else{if(65535>=m){if(r+2>=o)break;t[r++]=224|m>>12}else{if(r+3>=o)break;1114111<m&&Oe("Invalid Unicode code point "+Be(m)+" encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF)."),t[r++]=240|m>>18,t[r++]=128|m>>12&63}t[r++]=128|m>>6&63}t[r++]=128|m&63}}return t[r]=0,r-i};function Ge(e,t){var r=Array(Ae(e)+1);return e=_t(e,r,0,r.length),t&&(r.length=e),r}var bt=[];function en(e,t){bt[e]={input:[],output:[],K:t},vt(e,sr)}var sr={open(e){var t=bt[e.node.rdev];if(!t)throw new s.g(43);e.tty=t,e.seekable=!1},close(e){e.tty.K.fsync(e.tty)},fsync(e){e.tty.K.fsync(e.tty)},read(e,t,r,o){if(!e.tty||!e.tty.K.ra)throw new s.g(60);for(var i=0,c=0;c<o;c++){try{var m=e.tty.K.ra(e.tty)}catch{throw new s.g(29)}if(m===void 0&&i===0)throw new s.g(6);if(m==null)break;i++,t[r+c]=m}return i&&(e.node.timestamp=Date.now()),i},write(e,t,r,o){if(!e.tty||!e.tty.K.ia)throw new s.g(60);try{for(var i=0;i<o;i++)e.tty.K.ia(e.tty,t[r+i])}catch{throw new s.g(29)}return o&&(e.node.timestamp=Date.now()),i}},ir={ra(){e:{if(!gt.length){var e=null;if(P){var t=Buffer.alloc(256),r=0,o=process.stdin.fd;try{r=ot.readSync(o,t)}catch(i){if(i.toString().includes("EOF"))r=0;else throw i}0<r?e=t.slice(0,r).toString("utf-8"):e=null}else typeof window<"u"&&typeof window.prompt=="function"?(e=window.prompt("Input: "),e!==null&&(e+=`
`)):typeof readline=="function"&&(e=readline(),e!==null&&(e+=`
`));if(!e){e=null;break e}gt=Ge(e,!0)}e=gt.shift()}return e},ia(e,t){t===null||t===10?(Te(Me(e.output,0)),e.output=[]):t!=0&&e.output.push(t)},fsync(e){e.output&&0<e.output.length&&(Te(Me(e.output,0)),e.output=[])},Ia(){return{ab:25856,cb:5,$a:191,bb:35387,Za:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},Ja(){return 0},Ka(){return[24,80]}},lr={ia(e,t){t===null||t===10?(q(Me(e.output,0)),e.output=[]):t!=0&&e.output.push(t)},fsync(e){e.output&&0<e.output.length&&(q(Me(e.output,0)),e.output=[])}},tn=()=>{$("internal error: mmapAlloc called but `emscripten_builtin_memalign` native symbol not exported")};function nn(e,t){var r=e.m?e.m.length:0;r>=t||(t=Math.max(t,r*(1048576>r?2:1.125)>>>0),r!=0&&(t=Math.max(t,256)),r=e.m,e.m=new Uint8Array(t),0<e.o&&e.m.set(r.subarray(0,e.o),0))}var R={G:null,s(){return R.createNode(null,"/",16895,0)},createNode(e,t,r,o){if((r&61440)===24576||s.isFIFO(r))throw new s.g(63);return R.G||(R.G={dir:{node:{C:R.h.C,v:R.h.v,lookup:R.h.lookup,J:R.h.J,rename:R.h.rename,unlink:R.h.unlink,rmdir:R.h.rmdir,readdir:R.h.readdir,symlink:R.h.symlink},stream:{D:R.l.D}},file:{node:{C:R.h.C,v:R.h.v},stream:{D:R.l.D,read:R.l.read,write:R.l.write,T:R.l.T,S:R.l.S,V:R.l.V}},link:{node:{C:R.h.C,v:R.h.v,readlink:R.h.readlink},stream:{}},na:{node:{C:R.h.C,v:R.h.v},stream:s.Da}}),r=s.createNode(e,t,r,o),X(r.mode)?(r.h=R.G.dir.node,r.l=R.G.dir.stream,r.m={}):s.isFile(r.mode)?(r.h=R.G.file.node,r.l=R.G.file.stream,r.o=0,r.m=null):(r.mode&61440)===40960?(r.h=R.G.link.node,r.l=R.G.link.stream):(r.mode&61440)===8192&&(r.h=R.G.na.node,r.l=R.G.na.stream),r.timestamp=Date.now(),e&&(e.m[t]=r,e.timestamp=r.timestamp),r},lb(e){return e.m?e.m.subarray?e.m.subarray(0,e.o):new Uint8Array(e.m):new Uint8Array(0)},h:{C(e){var t={};return t.dev=(e.mode&61440)===8192?e.id:1,t.ino=e.id,t.mode=e.mode,t.nlink=1,t.uid=0,t.gid=0,t.rdev=e.rdev,X(e.mode)?t.size=4096:s.isFile(e.mode)?t.size=e.o:(e.mode&61440)===40960?t.size=e.link.length:t.size=0,t.atime=new Date(e.timestamp),t.mtime=new Date(e.timestamp),t.ctime=new Date(e.timestamp),t.Ba=4096,t.blocks=Math.ceil(t.size/t.Ba),t},v(e,t){if(t.mode!==void 0&&(e.mode=t.mode),t.timestamp!==void 0&&(e.timestamp=t.timestamp),t.size!==void 0&&(t=t.size,e.o!=t))if(t==0)e.m=null,e.o=0;else{var r=e.m;e.m=new Uint8Array(t),r&&e.m.set(r.subarray(0,Math.min(t,e.o))),e.o=t}},lookup(){throw s.da[44]},J(e,t,r,o){return R.createNode(e,t,r,o)},rename(e,t,r){if(X(e.mode)){try{var o=ie(t,r)}catch{}if(o)for(var i in o.m)throw new s.g(55)}delete e.parent.m[e.name],e.parent.timestamp=Date.now(),e.name=r,t.m[r]=e,t.timestamp=e.parent.timestamp,e.parent=t},unlink(e,t){delete e.m[t],e.timestamp=Date.now()},rmdir(e,t){var r=ie(e,t),o;for(o in r.m)throw new s.g(55);delete e.m[t],e.timestamp=Date.now()},readdir(e){var t=[".",".."],r;for(r in e.m)e.m.hasOwnProperty(r)&&t.push(r);return t},symlink(e,t,r){return e=R.createNode(e,t,41471,0),e.link=r,e},readlink(e){if((e.mode&61440)!==40960)throw new s.g(28);return e.link}},l:{read(e,t,r,o,i){var c=e.node.m;if(i>=e.node.o)return 0;if(e=Math.min(e.node.o-i,o),b(0<=e),8<e&&c.subarray)t.set(c.subarray(i,i+e),r);else for(o=0;o<e;o++)t[r+o]=c[i+o];return e},write(e,t,r,o,i,c){if(b(!(t instanceof ArrayBuffer)),t.buffer===Y.buffer&&(c=!1),!o)return 0;if(e=e.node,e.timestamp=Date.now(),t.subarray&&(!e.m||e.m.subarray)){if(c)return b(i===0,"canOwn must imply no weird position inside the file"),e.m=t.subarray(r,r+o),e.o=o;if(e.o===0&&i===0)return e.m=t.slice(r,r+o),e.o=o;if(i+o<=e.o)return e.m.set(t.subarray(r,r+o),i),o}if(nn(e,i+o),e.m.subarray&&t.subarray)e.m.set(t.subarray(r,r+o),i);else for(c=0;c<o;c++)e.m[i+c]=t[r+c];return e.o=Math.max(e.o,i+o),o},D(e,t,r){if(r===1?t+=e.position:r===2&&s.isFile(e.node.mode)&&(t+=e.node.o),0>t)throw new s.g(28);return t},T(e,t,r){nn(e.node,t+r),e.node.o=Math.max(e.node.o,t+r)},S(e,t,r,o,i){if(!s.isFile(e.node.mode))throw new s.g(43);if(e=e.node.m,i&2||e.buffer!==Y.buffer){if((0<r||r+t<e.length)&&(e.subarray?e=e.subarray(r,r+t):e=Array.prototype.slice.call(e,r,r+t)),r=!0,t=tn(),!t)throw new s.g(48);Y.set(e,t)}else r=!1,t=e.byteOffset;return{Ra:t,Aa:r}},V(e,t,r,o){return R.l.write(e,t,0,o,r,!1),0}}},ur=(e,t,r)=>{var o=Vt(`al ${e}`);ke(e,i=>{b(i,`Loading data file "${e}" failed (no arrayBuffer).`),t(new Uint8Array(i)),o&&Ye(o)},()=>{if(r)r();else throw`Loading data file "${e}" failed.`}),o&&ht(o)},cr=[],dr=(e,t,r,o)=>{typeof Browser<"u"&&Browser.R();var i=!1;return cr.forEach(c=>{!i&&c.canHandle(t)&&(c.handle(e,t,r,o),i=!0)}),i},wt=(e,t)=>{var r=0;return e&&(r|=365),t&&(r|=146),r},fr={0:"Success",1:"Arg list too long",2:"Permission denied",3:"Address already in use",4:"Address not available",5:"Address family not supported by protocol family",6:"No more processes",7:"Socket already connected",8:"Bad file number",9:"Trying to read unreadable message",10:"Mount device busy",11:"Operation canceled",12:"No children",13:"Connection aborted",14:"Connection refused",15:"Connection reset by peer",16:"File locking deadlock error",17:"Destination address required",18:"Math arg out of domain of func",19:"Quota exceeded",20:"File exists",21:"Bad address",22:"File too large",23:"Host is unreachable",24:"Identifier removed",25:"Illegal byte sequence",26:"Connection already in progress",27:"Interrupted system call",28:"Invalid argument",29:"I/O error",30:"Socket is already connected",31:"Is a directory",32:"Too many symbolic links",33:"Too many open files",34:"Too many links",35:"Message too long",36:"Multihop attempted",37:"File or path name too long",38:"Network interface is not configured",39:"Connection reset by network",40:"Network is unreachable",41:"Too many open files in system",42:"No buffer space available",43:"No such device",44:"No such file or directory",45:"Exec format error",46:"No record locks available",47:"The link has been severed",48:"Not enough core",49:"No message of desired type",50:"Protocol not available",51:"No space left on device",52:"Function not implemented",53:"Socket is not connected",54:"Not a directory",55:"Directory not empty",56:"State not recoverable",57:"Socket operation on non-socket",59:"Not a typewriter",60:"No such device or address",61:"Value too large for defined data type",62:"Previous owner died",63:"Not super-user",64:"Broken pipe",65:"Protocol error",66:"Unknown protocol",67:"Protocol wrong type for socket",68:"Math result not representable",69:"Read only file system",70:"Illegal seek",71:"No such process",72:"Stale file handle",73:"Connection timed out",74:"Text file busy",75:"Cross-device link",100:"Device not a stream",101:"Bad font file fmt",102:"Invalid slot",103:"Invalid request code",104:"No anode",105:"Block device required",106:"Channel number out of range",107:"Level 3 halted",108:"Level 3 reset",109:"Link number out of range",110:"Protocol driver not attached",111:"No CSI structure available",112:"Level 2 halted",113:"Invalid exchange",114:"Invalid request descriptor",115:"Exchange full",116:"No data (for no delay io)",117:"Timer expired",118:"Out of streams resources",119:"Machine is not on the network",120:"Package not installed",121:"The object is remote",122:"Advertise error",123:"Srmount error",124:"Communication error on send",125:"Cross mount point (not really error)",126:"Given log. name not unique",127:"f.d. invalid for this operation",128:"Remote address changed",129:"Can   access a needed shared lib",130:"Accessing a corrupted shared lib",131:".lib section in a.out corrupted",132:"Attempting to link in too many libs",133:"Attempting to exec a shared library",135:"Streams pipe error",136:"Too many users",137:"Socket type not supported",138:"Not supported",139:"Protocol family not supported",140:"Can't send after socket shutdown",141:"Too many references",142:"Host is down",148:"No medium (in tape drive)",156:"Level 2 not synchronized"},rn={EPERM:63,ENOENT:44,ESRCH:71,EINTR:27,EIO:29,ENXIO:60,E2BIG:1,ENOEXEC:45,EBADF:8,ECHILD:12,EAGAIN:6,EWOULDBLOCK:6,ENOMEM:48,EACCES:2,EFAULT:21,ENOTBLK:105,EBUSY:10,EEXIST:20,EXDEV:75,ENODEV:43,ENOTDIR:54,EISDIR:31,EINVAL:28,ENFILE:41,EMFILE:33,ENOTTY:59,ETXTBSY:74,EFBIG:22,ENOSPC:51,ESPIPE:70,EROFS:69,EMLINK:34,EPIPE:64,EDOM:18,ERANGE:68,ENOMSG:49,EIDRM:24,ECHRNG:106,EL2NSYNC:156,EL3HLT:107,EL3RST:108,ELNRNG:109,EUNATCH:110,ENOCSI:111,EL2HLT:112,EDEADLK:16,ENOLCK:46,EBADE:113,EBADR:114,EXFULL:115,ENOANO:104,EBADRQC:103,EBADSLT:102,EDEADLOCK:16,EBFONT:101,ENOSTR:100,ENODATA:116,ETIME:117,ENOSR:118,ENONET:119,ENOPKG:120,EREMOTE:121,ENOLINK:47,EADV:122,ESRMNT:123,ECOMM:124,EPROTO:65,EMULTIHOP:36,EDOTDOT:125,EBADMSG:9,ENOTUNIQ:126,EBADFD:127,EREMCHG:128,ELIBACC:129,ELIBBAD:130,ELIBSCN:131,ELIBMAX:132,ELIBEXEC:133,ENOSYS:52,ENOTEMPTY:55,ENAMETOOLONG:37,ELOOP:32,EOPNOTSUPP:138,EPFNOSUPPORT:139,ECONNRESET:15,ENOBUFS:42,EAFNOSUPPORT:5,EPROTOTYPE:67,ENOTSOCK:57,ENOPROTOOPT:50,ESHUTDOWN:140,ECONNREFUSED:14,EADDRINUSE:3,ECONNABORTED:13,ENETUNREACH:40,ENETDOWN:38,ETIMEDOUT:73,EHOSTDOWN:142,EHOSTUNREACH:23,EINPROGRESS:26,EALREADY:7,EDESTADDRREQ:17,EMSGSIZE:35,EPROTONOSUPPORT:66,ESOCKTNOSUPPORT:137,EADDRNOTAVAIL:4,ENETRESET:39,EISCONN:30,ENOTCONN:53,ETOOMANYREFS:141,EUSERS:136,EDQUOT:19,ESTALE:72,ENOTSUP:138,ENOMEDIUM:148,EILSEQ:25,EOVERFLOW:61,ECANCELED:11,ENOTRECOVERABLE:56,EOWNERDEAD:62,ESTRPIPE:135},hr=e=>e.replace(/\b_Z[\w\d_]+/g,function(t){return Oe("warning: build with -sDEMANGLE_SUPPORT to link in libcxxabi demangling"),t===t?t:t+" ["+t+"]"});function vt(e,t){s.pa[e]={l:t}}function X(e){return(e&61440)===16384}function ie(e,t){var r;if(r=(r=pe(e,"x"))?r:e.h.lookup?0:2)throw new s.g(r,e);for(r=s.F[yt(e.id,t)];r;r=r.N){var o=r.name;if(r.parent.id===e.id&&o===t)return r}return s.lookup(e,t)}function W(e,t={}){if(e=he(e),!e)return{path:"",node:null};if(t=Object.assign({ba:!0,ka:0},t),8<t.ka)throw new s.g(32);e=e.split("/").filter(m=>!!m);for(var r=s.root,o="/",i=0;i<e.length;i++){var c=i===e.length-1;if(c&&t.parent)break;if(r=ie(r,e[i]),o=se(o+"/"+e[i]),r.A&&(!c||c&&t.ba)&&(r=r.A.root),!c||t.B){for(c=0;(r.mode&61440)===40960;)if(r=s.readlink(o),o=he(pt(o),r),r=W(o,{ka:t.ka+1}).node,40<c++)throw new s.g(32)}}return{path:o,node:r}}function me(e){for(var t;;){if(s.Z(e))return e=e.s.ua,t?e[e.length-1]!=="/"?`${e}/${t}`:e+t:e;t=t?`${e.name}/${t}`:e.name,e=e.parent}}function yt(e,t){for(var r=0,o=0;o<t.length;o++)r=(r<<5)-r+t.charCodeAt(o)|0;return(e+r>>>0)%s.F.length}function an(e){var t=yt(e.parent.id,e.name);e.N=s.F[t],s.F[t]=e}function Ke(e){var t=yt(e.parent.id,e.name);if(s.F[t]===e)s.F[t]=e.N;else for(t=s.F[t];t;){if(t.N===e){t.N=e.N;break}t=t.N}}function on(e){var t=["r","w","rw"][e&3];return e&512&&(t+="w"),t}function pe(e,t){if(s.ta)return 0;if(!t.includes("r")||e.mode&292){if(t.includes("w")&&!(e.mode&146)||t.includes("x")&&!(e.mode&73))return 2}else return 2;return 0}function kt(e,t){try{return ie(e,t),20}catch{}return pe(e,"wx")}function Xe(e,t,r){try{var o=ie(e,t)}catch(i){return i.u}if(e=pe(e,"wx"))return e;if(r){if(!X(o.mode))return 54;if(s.Z(o)||me(o)===s.cwd())return 10}else if(X(o.mode))return 31;return 0}function mr(){for(var e=0;e<=s.xa;e++)if(!s.streams[e])return e;throw new s.g(33)}function Q(e){if(e=s.qa(e),!e)throw new s.g(8);return e}function Et(e,t=-1){return s.X||(s.X=function(){this.I={}},s.X.prototype={},Object.defineProperties(s.X.prototype,{object:{get(){return this.node},set(r){this.node=r}},flags:{get(){return this.I.flags},set(r){this.I.flags=r}},position:{get(){return this.I.position},set(r){this.I.position=r}}})),e=Object.assign(new s.X,e),t==-1&&(t=mr()),e.fd=t,s.streams[t]=e}function sn(e){var t=[];for(e=[e];e.length;){var r=e.pop();t.push(r),e.push.apply(e,r.U)}return t}function Je(e,t,r){return typeof r>"u"&&(r=t,t=438),s.J(e,t|8192,r)}function ln(){s.g||(s.g=function(e,t){this.name="ErrnoError",this.node=t,this.Sa=function(r){this.u=r;for(var o in rn)if(rn[o]===r){this.code=o;break}},this.Sa(e),this.message=fr[e],this.stack&&(Object.defineProperty(this,"stack",{value:Error().stack,writable:!0}),this.stack=hr(this.stack))},s.g.prototype=Error(),s.g.prototype.constructor=s.g,[44].forEach(e=>{s.da[e]=new s.g(e),s.da[e].stack="<generic error, no stack>"}))}function un(e,t){try{var r=W(e,{B:!t});e=r.path}catch{}var o={Z:!1,exists:!1,error:0,name:null,path:null,object:null,Oa:!1,Qa:null,Pa:null};try{r=W(e,{parent:!0}),o.Oa=!0,o.Qa=r.path,o.Pa=r.node,o.name=fe(e),r=W(e,{B:!t}),o.exists=!0,o.path=r.path,o.object=r.node,o.name=r.node.name,o.Z=r.path==="/"}catch(i){o.error=i.u}return o}function pr(e,t,r,o){return e=typeof e=="string"?e:me(e),t=se(e+"/"+t),s.create(t,wt(r,o))}function Lt(e){if(!(e.La||e.Ma||e.link||e.m)){if(typeof XMLHttpRequest<"u")throw Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");if(ye)try{e.m=Ge(ye(e.url),!0),e.o=e.m.length}catch{throw new s.g(29)}else throw Error("Cannot load without read() or XMLHttpRequest.")}}var s={root:null,U:[],pa:{},streams:[],Na:1,F:null,oa:"/",Y:!1,ta:!0,g:null,da:{},Fa:null,W:0,createNode(e,t,r,o){return b(typeof e=="object"),e=new s.wa(e,t,r,o),an(e),e},Z(e){return e===e.parent},isFile(e){return(e&61440)===32768},isFIFO(e){return(e&61440)===4096},isSocket(e){return(e&49152)===49152},xa:4096,qa:e=>s.streams[e],Da:{open(e){e.l=s.Ga(e.node.rdev).l,e.l.open&&e.l.open(e)},D(){throw new s.g(70)}},ha:e=>e>>8,nb:e=>e&255,M:(e,t)=>e<<8|t,Ga:e=>s.pa[e],va(e,t){function r(m){return b(0<s.W),s.W--,t(m)}function o(m){if(m){if(!o.Ea)return o.Ea=!0,r(m)}else++c>=i.length&&r(null)}typeof e=="function"&&(t=e,e=!1),s.W++,1<s.W&&q(`warning: ${s.W} FS.syncfs operations in flight at once, probably just doing extra work`);var i=sn(s.root.s),c=0;i.forEach(m=>{if(!m.type.va)return o(null);m.type.va(m,e,o)})},s(e,t,r){if(typeof e=="string")throw e;var o=r==="/",i=!r;if(o&&s.root)throw new s.g(10);if(!o&&!i){var c=W(r,{ba:!1});if(r=c.path,c=c.node,c.A)throw new s.g(10);if(!X(c.mode))throw new s.g(54)}return t={type:e,rb:t,ua:r,U:[]},e=e.s(t),e.s=t,t.root=e,o?s.root=e:c&&(c.A=t,c.s&&c.s.U.push(t)),e},xb(e){if(e=W(e,{ba:!1}),!e.node.A)throw new s.g(28);e=e.node;var t=e.A,r=sn(t);Object.keys(s.F).forEach(o=>{for(o=s.F[o];o;){var i=o.N;r.includes(o.s)&&Ke(o),o=i}}),e.A=null,t=e.s.U.indexOf(t),b(t!==-1),e.s.U.splice(t,1)},lookup(e,t){return e.h.lookup(e,t)},J(e,t,r){var o=W(e,{parent:!0}).node;if(e=fe(e),!e||e==="."||e==="..")throw new s.g(28);var i=kt(o,e);if(i)throw new s.g(i);if(!o.h.J)throw new s.g(63);return o.h.J(o,e,t,r)},create(e,t){return s.J(e,(t!==void 0?t:438)&4095|32768,0)},mkdir(e,t){return s.J(e,(t!==void 0?t:511)&1023|16384,0)},ob(e,t){e=e.split("/");for(var r="",o=0;o<e.length;++o)if(e[o]){r+="/"+e[o];try{s.mkdir(r,t)}catch(i){if(i.u!=20)throw i}}},symlink(e,t){if(!he(e))throw new s.g(44);var r=W(t,{parent:!0}).node;if(!r)throw new s.g(44);t=fe(t);var o=kt(r,t);if(o)throw new s.g(o);if(!r.h.symlink)throw new s.g(63);return r.h.symlink(r,t,e)},rename(e,t){var r=pt(e),o=pt(t),i=fe(e),c=fe(t),m=W(e,{parent:!0}),w=m.node;if(m=W(t,{parent:!0}),m=m.node,!w||!m)throw new s.g(44);if(w.s!==m.s)throw new s.g(75);var F=ie(w,i);if(e=Zt(e,o),e.charAt(0)!==".")throw new s.g(28);if(e=Zt(t,r),e.charAt(0)!==".")throw new s.g(55);try{var v=ie(m,c)}catch{}if(F!==v){if(t=X(F.mode),i=Xe(w,i,t))throw new s.g(i);if(i=v?Xe(m,c,t):kt(m,c))throw new s.g(i);if(!w.h.rename)throw new s.g(63);if(F.A||v&&v.A)throw new s.g(10);if(m!==w&&(i=pe(w,"w")))throw new s.g(i);Ke(F);try{w.h.rename(F,m,c)}catch(A){throw A}finally{an(F)}}},rmdir(e){var t=W(e,{parent:!0}).node;e=fe(e);var r=ie(t,e),o=Xe(t,e,!0);if(o)throw new s.g(o);if(!t.h.rmdir)throw new s.g(63);if(r.A)throw new s.g(10);t.h.rmdir(t,e),Ke(r)},readdir(e){if(e=W(e,{B:!0}).node,!e.h.readdir)throw new s.g(54);return e.h.readdir(e)},unlink(e){var t=W(e,{parent:!0}).node;if(!t)throw new s.g(44);e=fe(e);var r=ie(t,e),o=Xe(t,e,!1);if(o)throw new s.g(o);if(!t.h.unlink)throw new s.g(63);if(r.A)throw new s.g(10);t.h.unlink(t,e),Ke(r)},readlink(e){if(e=W(e).node,!e)throw new s.g(44);if(!e.h.readlink)throw new s.g(28);return he(me(e.parent),e.h.readlink(e))},stat(e,t){if(e=W(e,{B:!t}).node,!e)throw new s.g(44);if(!e.h.C)throw new s.g(63);return e.h.C(e)},lstat(e){return s.stat(e,!0)},chmod(e,t,r){if(e=typeof e=="string"?W(e,{B:!r}).node:e,!e.h.v)throw new s.g(63);e.h.v(e,{mode:t&4095|e.mode&-4096,timestamp:Date.now()})},lchmod(e,t){s.chmod(e,t,!0)},fchmod(e,t){e=Q(e),s.chmod(e.node,t)},chown(e,t,r,o){if(e=typeof e=="string"?W(e,{B:!o}).node:e,!e.h.v)throw new s.g(63);e.h.v(e,{timestamp:Date.now()})},lchown(e,t,r){s.chown(e,t,r,!0)},fchown(e,t,r){e=Q(e),s.chown(e.node,t,r)},truncate(e,t){if(0>t)throw new s.g(28);if(e=typeof e=="string"?W(e,{B:!0}).node:e,!e.h.v)throw new s.g(63);if(X(e.mode))throw new s.g(31);if(!s.isFile(e.mode))throw new s.g(28);var r=pe(e,"w");if(r)throw new s.g(r);e.h.v(e,{size:t,timestamp:Date.now()})},kb(e,t){if(e=Q(e),(e.flags&2097155)===0)throw new s.g(28);s.truncate(e.node,t)},yb(e,t,r){e=W(e,{B:!0}).node,e.h.v(e,{timestamp:Math.max(t,r)})},open(e,t,r){if(e==="")throw new s.g(44);if(typeof t=="string"){var o={r:0,"r+":2,w:577,"w+":578,a:1089,"a+":1090}[t];if(typeof o>"u")throw Error(`Unknown file open mode: ${t}`);t=o}if(r=t&64?(typeof r>"u"?438:r)&4095|32768:0,typeof e=="object")var i=e;else{e=se(e);try{i=W(e,{B:!(t&131072)}).node}catch{}}if(o=!1,t&64)if(i){if(t&128)throw new s.g(20)}else i=s.J(e,r,0),o=!0;if(!i)throw new s.g(44);if((i.mode&61440)===8192&&(t&=-513),t&65536&&!X(i.mode))throw new s.g(54);if(!o&&(r=i?(i.mode&61440)===40960?32:X(i.mode)&&(on(t)!=="r"||t&512)?31:pe(i,on(t)):44))throw new s.g(r);return t&512&&!o&&s.truncate(i,0),t&=-131713,i=Et({node:i,path:me(i),flags:t,seekable:!0,position:0,l:i.l,Xa:[],error:!1}),i.l.open&&i.l.open(i),!a.logReadFiles||t&1||(s.ja||(s.ja={}),e in s.ja||(s.ja[e]=1)),i},close(e){if(e.fd===null)throw new s.g(8);e.ea&&(e.ea=null);try{e.l.close&&e.l.close(e)}catch(t){throw t}finally{s.streams[e.fd]=null}e.fd=null},D(e,t,r){if(e.fd===null)throw new s.g(8);if(!e.seekable||!e.l.D)throw new s.g(70);if(r!=0&&r!=1&&r!=2)throw new s.g(28);return e.position=e.l.D(e,t,r),e.Xa=[],e.position},read(e,t,r,o,i){if(b(0<=r),0>o||0>i)throw new s.g(28);if(e.fd===null)throw new s.g(8);if((e.flags&2097155)===1)throw new s.g(8);if(X(e.node.mode))throw new s.g(31);if(!e.l.read)throw new s.g(28);var c=typeof i<"u";if(!c)i=e.position;else if(!e.seekable)throw new s.g(70);return t=e.l.read(e,t,r,o,i),c||(e.position+=t),t},write(e,t,r,o,i,c){if(b(0<=r),0>o||0>i)throw new s.g(28);if(e.fd===null)throw new s.g(8);if((e.flags&2097155)===0)throw new s.g(8);if(X(e.node.mode))throw new s.g(31);if(!e.l.write)throw new s.g(28);e.seekable&&e.flags&1024&&s.D(e,0,2);var m=typeof i<"u";if(!m)i=e.position;else if(!e.seekable)throw new s.g(70);return t=e.l.write(e,t,r,o,i,c),m||(e.position+=t),t},T(e,t,r){if(e.fd===null)throw new s.g(8);if(0>t||0>=r)throw new s.g(28);if((e.flags&2097155)===0)throw new s.g(8);if(!s.isFile(e.node.mode)&&!X(e.node.mode))throw new s.g(43);if(!e.l.T)throw new s.g(138);e.l.T(e,t,r)},S(e,t,r,o,i){if((o&2)!==0&&(i&2)===0&&(e.flags&2097155)!==2)throw new s.g(2);if((e.flags&2097155)===1)throw new s.g(2);if(!e.l.S)throw new s.g(43);return e.l.S(e,t,r,o,i)},V(e,t,r,o,i){return b(0<=r),e.l.V?e.l.V(e,t,r,o,i):0},qb:()=>0,fa(e,t,r){if(!e.l.fa)throw new s.g(59);return e.l.fa(e,t,r)},readFile(e,t={}){if(t.flags=t.flags||0,t.encoding=t.encoding||"binary",t.encoding!=="utf8"&&t.encoding!=="binary")throw Error(`Invalid encoding type "${t.encoding}"`);var r,o=s.open(e,t.flags);e=s.stat(e).size;var i=new Uint8Array(e);return s.read(o,i,0,e,0),t.encoding==="utf8"?r=Me(i,0):t.encoding==="binary"&&(r=i),s.close(o),r},writeFile(e,t,r={}){if(r.flags=r.flags||577,e=s.open(e,r.flags,r.mode),typeof t=="string"){var o=new Uint8Array(Ae(t)+1);t=_t(t,o,0,o.length),s.write(e,o,0,t,void 0,r.Ca)}else if(ArrayBuffer.isView(t))s.write(e,t,0,t.byteLength,void 0,r.Ca);else throw Error("Unsupported data type");s.close(e)},cwd:()=>s.oa,chdir(e){if(e=W(e,{B:!0}),e.node===null)throw new s.g(44);if(!X(e.node.mode))throw new s.g(54);var t=pe(e.node,"x");if(t)throw new s.g(t);s.oa=e.path},R(e,t,r){b(!s.R.Y,"FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)"),s.R.Y=!0,ln(),a.stdin=e||a.stdin,a.stdout=t||a.stdout,a.stderr=r||a.stderr,a.stdin?s.L("/dev","stdin",a.stdin):s.symlink("/dev/tty","/dev/stdin"),a.stdout?s.L("/dev","stdout",null,a.stdout):s.symlink("/dev/tty","/dev/stdout"),a.stderr?s.L("/dev","stderr",null,a.stderr):s.symlink("/dev/tty1","/dev/stderr"),e=s.open("/dev/stdin",0),t=s.open("/dev/stdout",1),r=s.open("/dev/stderr",1),b(e.fd===0,`invalid handle for stdin (${e.fd})`),b(t.fd===1,`invalid handle for stdout (${t.fd})`),b(r.fd===2,`invalid handle for stderr (${r.fd})`)},sb(){s.R.Y=!1,bn(0);for(var e=0;e<s.streams.length;e++){var t=s.streams[e];t&&s.close(t)}},jb(e,t){return e=un(e,t),e.exists?e.object:null},hb(e,t){for(e=typeof e=="string"?e:me(e),t=t.split("/").reverse();t.length;){var r=t.pop();if(r){var o=se(e+"/"+r);try{s.mkdir(o)}catch{}e=o}}return o},L(e,t,r,o){e=ar(typeof e=="string"?e:me(e),t),t=wt(!!r,!!o),s.L.ha||(s.L.ha=64);var i=s.M(s.L.ha++,0);return vt(i,{open(c){c.seekable=!1},close(){o&&o.buffer&&o.buffer.length&&o(10)},read(c,m,w,F){for(var v=0,A=0;A<F;A++){try{var E=r()}catch{throw new s.g(29)}if(E===void 0&&v===0)throw new s.g(6);if(E==null)break;v++,m[w+A]=E}return v&&(c.node.timestamp=Date.now()),v},write(c,m,w,F){for(var v=0;v<F;v++)try{o(m[w+v])}catch{throw new s.g(29)}return F&&(c.node.timestamp=Date.now()),v}}),Je(e,t,i)},fb(e,t,r,o,i){function c(){this.ga=!1,this.I=[]}function m(E,B,h,O,S){if(E=E.node.m,S>=E.length)return 0;if(O=Math.min(E.length-S,O),b(0<=O),E.slice)for(var I=0;I<O;I++)B[h+I]=E[S+I];else for(I=0;I<O;I++)B[h+I]=E.get(S+I);return O}if(c.prototype.get=function(E){if(!(E>this.length-1||0>E)){var B=E%this.chunkSize;return this.sa(E/this.chunkSize|0)[B]}},c.prototype.Ha=function(E){this.sa=E},c.prototype.ma=function(){var E=new XMLHttpRequest;if(E.open("HEAD",r,!1),E.send(null),!(200<=E.status&&300>E.status||E.status===304))throw Error("Couldn't load "+r+". Status: "+E.status);var B=Number(E.getResponseHeader("Content-length")),h,O=(h=E.getResponseHeader("Accept-Ranges"))&&h==="bytes";E=(h=E.getResponseHeader("Content-Encoding"))&&h==="gzip";var S=1048576;O||(S=B);var I=this;I.Ha(G=>{var ee=G*S,te=(G+1)*S-1;if(te=Math.min(te,B-1),typeof I.I[G]>"u"){var Ft=I.I;if(ee>te)throw Error("invalid range ("+ee+", "+te+") or no bytes requested!");if(te>B-1)throw Error("only "+B+" bytes available! programmer error!");var Z=new XMLHttpRequest;if(Z.open("GET",r,!1),B!==S&&Z.setRequestHeader("Range","bytes="+ee+"-"+te),Z.responseType="arraybuffer",Z.overrideMimeType&&Z.overrideMimeType("text/plain; charset=x-user-defined"),Z.send(null),!(200<=Z.status&&300>Z.status||Z.status===304))throw Error("Couldn't load "+r+". Status: "+Z.status);ee=Z.response!==void 0?new Uint8Array(Z.response||[]):Ge(Z.responseText||"",!0),Ft[G]=ee}if(typeof I.I[G]>"u")throw Error("doXHR failed!");return I.I[G]}),(E||!B)&&(S=B=1,S=B=this.sa(0).length,Te("LazyFiles on gzip forces download of the whole file when length is accessed")),this.za=B,this.ya=S,this.ga=!0},typeof XMLHttpRequest<"u"){if(!D)throw"Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";var w=new c;Object.defineProperties(w,{length:{get:function(){return this.ga||this.ma(),this.za}},chunkSize:{get:function(){return this.ga||this.ma(),this.ya}}});var F=void 0}else F=r,w=void 0;var v=pr(e,t,o,i);w?v.m=w:F&&(v.m=null,v.url=F),Object.defineProperties(v,{o:{get:function(){return this.m.length}}});var A={};return Object.keys(v.l).forEach(E=>{var B=v.l[E];A[E]=function(){return Lt(v),B.apply(null,arguments)}}),A.read=(E,B,h,O,S)=>(Lt(v),m(E,B,h,O,S)),A.S=(E,B,h)=>{Lt(v);var O=tn();if(!O)throw new s.g(48);return m(E,Y,O,B,h),{Ra:O,Aa:!0}},v.l=A,v},Ya(){$("FS.absolutePath has been removed; use PATH_FS.resolve instead")},eb(){$("FS.createFolder has been removed; use FS.mkdir instead")},gb(){$("FS.createLink has been removed; use FS.symlink instead")},mb(){$("FS.joinPath has been removed; use PATH.join instead")},pb(){$("FS.mmapAlloc has been replaced by the top level function mmapAlloc")},vb(){$("FS.standardizePath has been removed; use PATH.normalize instead")}},re=e=>(b(typeof e=="number",`UTF8ToString expects a number (got ${typeof e})`),e?Me(qe,e):"");function ze(e,t){if(t.charAt(0)==="/")return t;if(e=e===-100?s.cwd():Q(e).path,t.length==0)throw new s.g(44);return se(e+"/"+t)}var Fe=void 0;function le(){b(Fe!=null);var e=k[+Fe>>2];return Fe+=4,e}var Ze=(e,t,r)=>(b(typeof r=="number","stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!"),_t(e,qe,t,r)),Re=e=>e%4===0&&(e%100!==0||e%400===0),cn=[0,31,60,91,121,152,182,213,244,274,305,335],dn=[0,31,59,90,120,151,181,212,243,273,304,334],Tt=e=>{var t=Ae(e)+1,r=_r(t);return r&&Ze(e,r,t),r},Qe={},fn=()=>{if(!xt){var e={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:(typeof navigator=="object"&&navigator.languages&&navigator.languages[0]||"C").replace("-","_")+".UTF-8",_:y||"./this.program"},t;for(t in Qe)Qe[t]===void 0?delete e[t]:e[t]=Qe[t];var r=[];for(t in e)r.push(`${t}=${e[t]}`);xt=r}return xt},xt,hn=[31,29,31,30,31,30,31,31,30,31,30,31],mn=[31,28,31,30,31,30,31,31,30,31,30,31],pn=(e,t)=>{b(0<=e.length,"writeArrayToMemory array must have a length (should be an array or typed array)"),Y.set(e,t)},ge=[],J,St=e=>{var t=ge[e];return t||(e>=ge.length&&(ge.length=e+1),ge[e]=t=J.get(e)),b(J.get(e)==t,"JavaScript-side Wasm function table mirror is out of date!"),t},gr=e=>{var t=a["_"+e];return b(t,"Cannot call unknown function "+e+", make sure it is exported"),t},_e,Ot=[];function gn(e,t,r,o){e||=this,this.parent=e,this.s=e.s,this.A=null,this.id=s.Na++,this.name=t,this.mode=r,this.h={},this.l={},this.rdev=o}Object.defineProperties(gn.prototype,{read:{get:function(){return(this.mode&365)===365},set:function(e){e?this.mode|=365:this.mode&=-366}},write:{get:function(){return(this.mode&146)===146},set:function(e){e?this.mode|=146:this.mode&=-147}},Ma:{get:function(){return X(this.mode)}},La:{get:function(){return(this.mode&61440)===8192}}}),s.wa=gn,s.ib=(e,t,r,o,i,c,m,w,F,v)=>{function A(h){function O(S){if(v&&v(),!w){var I=e,G=t;if(I&&(I=typeof I=="string"?I:me(I),G=t?se(I+"/"+t):I),I=wt(o,i),G=s.create(G,I),S){if(typeof S=="string"){for(var ee=Array(S.length),te=0,Ft=S.length;te<Ft;++te)ee[te]=S.charCodeAt(te);S=ee}s.chmod(G,I|146),ee=s.open(G,577),s.write(ee,S,0,S.length,0,F),s.close(ee),s.chmod(G,I)}}c&&c(),Ye(B)}dr(h,E,O,()=>{m&&m(),Ye(B)})||O(h)}var E=t?he(se(e+"/"+t)):e,B=Vt(`cp ${E}`);ht(B),typeof r=="string"?ur(r,h=>A(h),m):A(r)},ln(),s.F=Array(4096),s.s(R,{},"/"),s.mkdir("/tmp"),s.mkdir("/home"),s.mkdir("/home/web_user"),(function(){s.mkdir("/dev"),vt(s.M(1,3),{read:()=>0,write:(o,i,c,m)=>m}),Je("/dev/null",s.M(1,3)),en(s.M(5,0),ir),en(s.M(6,0),lr),Je("/dev/tty",s.M(5,0)),Je("/dev/tty1",s.M(6,0));var e=new Uint8Array(1024),t=0,r=()=>(t===0&&(t=Jt(e).byteLength),e[--t]);s.L("/dev","random",r),s.L("/dev","urandom",r),s.mkdir("/dev/shm"),s.mkdir("/dev/shm/tmp")})(),(function(){s.mkdir("/proc");var e=s.mkdir("/proc/self");s.mkdir("/proc/self/fd"),s.s({s(){var t=s.createNode(e,"fd",16895,73);return t.h={lookup(r,o){var i=Q(+o);return r={parent:null,s:{ua:"fake"},h:{readlink:()=>i.path}},r.parent=r}},t}},{},"/proc/self/fd")})(),s.Fa={MEMFS:R};var _n={__syscall_dup3:function(e,t,r){try{var o=Q(e);if(b(!r),o.fd===t)return-28;var i=s.qa(t);return i&&s.close(i),Et(o,t).fd}catch(c){if(typeof s>"u"||c.name!=="ErrnoError")throw c;return-c.u}},__syscall_fcntl64:function(e,t,r){Fe=r;try{var o=Q(e);switch(t){case 0:var i=le();if(0>i)return-28;for(;s.streams[i];)i++;return Et(o,i).fd;case 1:case 2:return 0;case 3:return o.flags;case 4:return i=le(),o.flags|=i,0;case 5:return i=le(),xe[i+0>>1]=2,0;case 6:case 7:return 0;case 16:case 8:return-28;case 9:return k[Mt()>>2]=28,-1;default:return-28}}catch(c){if(typeof s>"u"||c.name!=="ErrnoError")throw c;return-c.u}},__syscall_ioctl:function(e,t,r){Fe=r;try{var o=Q(e);switch(t){case 21509:return o.tty?0:-59;case 21505:if(!o.tty)return-59;if(o.tty.K.Ia){e=[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];var i=le();k[i>>2]=25856,k[i+4>>2]=5,k[i+8>>2]=191,k[i+12>>2]=35387;for(var c=0;32>c;c++)Y[i+c+17>>0]=e[c]||0}return 0;case 21510:case 21511:case 21512:return o.tty?0:-59;case 21506:case 21507:case 21508:if(!o.tty)return-59;if(o.tty.K.Ja)for(i=le(),e=[],c=0;32>c;c++)e.push(Y[i+c+17>>0]);return 0;case 21519:return o.tty?(i=le(),k[i>>2]=0):-59;case 21520:return o.tty?-28:-59;case 21531:return i=le(),s.fa(o,t,i);case 21523:return o.tty?(o.tty.K.Ka&&(c=[24,80],i=le(),xe[i>>1]=c[0],xe[i+2>>1]=c[1]),0):-59;case 21524:return o.tty?0:-59;case 21515:return o.tty?0:-59;default:return-28}}catch(m){if(typeof s>"u"||m.name!=="ErrnoError")throw m;return-m.u}},__syscall_openat:function(e,t,r,o){Fe=o;try{t=re(t),t=ze(e,t);var i=o?le():0;return s.open(t,r,i).fd}catch(c){if(typeof s>"u"||c.name!=="ErrnoError")throw c;return-c.u}},__syscall_readlinkat:function(e,t,r,o){try{if(t=re(t),t=ze(e,t),0>=o)return-28;var i=s.readlink(t),c=Math.min(o,Ae(i)),m=Y[r+c];return Ze(i,r,o+1),Y[r+c]=m,c}catch(w){if(typeof s>"u"||w.name!=="ErrnoError")throw w;return-w.u}},__syscall_renameat:function(e,t,r,o){try{return t=re(t),o=re(o),t=ze(e,t),o=ze(r,o),s.rename(t,o),0}catch(i){if(typeof s>"u"||i.name!=="ErrnoError")throw i;return-i.u}},__syscall_rmdir:function(e){try{return e=re(e),s.rmdir(e),0}catch(t){if(typeof s>"u"||t.name!=="ErrnoError")throw t;return-t.u}},__syscall_unlinkat:function(e,t,r){try{return t=re(t),t=ze(e,t),r===0?s.unlink(t):r===512?s.rmdir(t):$("Invalid flags passed to unlinkat"),0}catch(o){if(typeof s>"u"||o.name!=="ErrnoError")throw o;return-o.u}},_emscripten_get_now_is_monotonic:()=>1,_emscripten_throw_longjmp:()=>{throw 1/0},_gmtime_js:function(e,t){e=-9007199254740992>e||9007199254740992<e?NaN:Number(e),e=new Date(1e3*e),k[t>>2]=e.getUTCSeconds(),k[t+4>>2]=e.getUTCMinutes(),k[t+8>>2]=e.getUTCHours(),k[t+12>>2]=e.getUTCDate(),k[t+16>>2]=e.getUTCMonth(),k[t+20>>2]=e.getUTCFullYear()-1900,k[t+24>>2]=e.getUTCDay(),k[t+28>>2]=(e.getTime()-Date.UTC(e.getUTCFullYear(),0,1,0,0,0,0))/864e5|0},_localtime_js:function(e,t){e=-9007199254740992>e||9007199254740992<e?NaN:Number(e),e=new Date(1e3*e),k[t>>2]=e.getSeconds(),k[t+4>>2]=e.getMinutes(),k[t+8>>2]=e.getHours(),k[t+12>>2]=e.getDate(),k[t+16>>2]=e.getMonth(),k[t+20>>2]=e.getFullYear()-1900,k[t+24>>2]=e.getDay(),k[t+28>>2]=(Re(e.getFullYear())?cn:dn)[e.getMonth()]+e.getDate()-1|0,k[t+36>>2]=-(60*e.getTimezoneOffset());var r=new Date(e.getFullYear(),6,1).getTimezoneOffset(),o=new Date(e.getFullYear(),0,1).getTimezoneOffset();k[t+32>>2]=(r!=o&&e.getTimezoneOffset()==Math.min(o,r))|0},_mktime_js:function(e){var t=new Date(k[e+20>>2]+1900,k[e+16>>2],k[e+12>>2],k[e+8>>2],k[e+4>>2],k[e>>2],0),r=k[e+32>>2],o=t.getTimezoneOffset(),i=new Date(t.getFullYear(),6,1).getTimezoneOffset(),c=new Date(t.getFullYear(),0,1).getTimezoneOffset(),m=Math.min(c,i);return 0>r?k[e+32>>2]=+(i!=c&&m==o):0<r!=(m==o)&&(i=Math.max(c,i),t.setTime(t.getTime()+6e4*((0<r?m:i)-o))),k[e+24>>2]=t.getDay(),k[e+28>>2]=(Re(t.getFullYear())?cn:dn)[t.getMonth()]+t.getDate()-1|0,k[e>>2]=t.getSeconds(),k[e+4>>2]=t.getMinutes(),k[e+8>>2]=t.getHours(),k[e+12>>2]=t.getDate(),k[e+16>>2]=t.getMonth(),k[e+20>>2]=t.getYear(),e=t.getTime(),isNaN(e)?(k[Mt()>>2]=61,e=-1):e/=1e3,BigInt(e)},_tzset_js:(e,t,r)=>{function o(F){return(F=F.toTimeString().match(/\(([A-Za-z ]+)\)$/))?F[1]:"GMT"}var i=new Date().getFullYear(),c=new Date(i,0,1),m=new Date(i,6,1);i=c.getTimezoneOffset();var w=m.getTimezoneOffset();z[e>>2]=60*Math.max(i,w),k[t>>2]=+(i!=w),e=o(c),t=o(m),e=Tt(e),t=Tt(t),w<i?(z[r>>2]=e,z[r+4>>2]=t):(z[r>>2]=t,z[r+4>>2]=e)},abort:()=>{$("native code called abort()")},emscripten_date_now:()=>Date.now(),emscripten_get_now:()=>performance.now(),emscripten_resize_heap:e=>{var t=qe.length;if(e>>>=0,b(e>t),2147483648<e)return q(`Cannot enlarge memory, requested ${e} bytes, but the limit is ${2147483648} bytes!`),!1;for(var r=1;4>=r;r*=2){var o=t*(1+.2/r);o=Math.min(o,e+100663296);var i=Math;o=Math.max(e,o),i=i.min.call(i,2147483648,o+(65536-o%65536)%65536);e:{o=i;var c=De.buffer,m=(o-c.byteLength+65535)/65536;try{De.grow(m),Ct();var w=1;break e}catch(F){q(`growMemory: Attempted to grow heap from ${c.byteLength} bytes to ${o} bytes, but got error: ${F}`)}w=void 0}if(w)return!0}return q(`Failed to grow the heap from ${t} bytes to ${i} bytes, not enough memory!`),!1},environ_get:(e,t)=>{var r=0;return fn().forEach((o,i)=>{var c=t+r;for(i=z[e+4*i>>2]=c,c=0;c<o.length;++c)b(o.charCodeAt(c)===(o.charCodeAt(c)&255)),Y[i++>>0]=o.charCodeAt(c);Y[i>>0]=0,r+=o.length+1}),0},environ_sizes_get:(e,t)=>{var r=fn();z[e>>2]=r.length;var o=0;return r.forEach(i=>o+=i.length+1),z[t>>2]=o,0},exit:e=>{vr(),Ie=!0,M(e,new Kt(e))},fd_close:function(e){try{var t=Q(e);return s.close(t),0}catch(r){if(typeof s>"u"||r.name!=="ErrnoError")throw r;return r.u}},fd_read:function(e,t,r,o){try{e:{var i=Q(e);e=t;for(var c,m=t=0;m<r;m++){var w=z[e>>2],F=z[e+4>>2];e+=8;var v=s.read(i,Y,w,F,c);if(0>v){var A=-1;break e}if(t+=v,v<F)break;typeof c<"u"&&(c+=v)}A=t}return z[o>>2]=A,0}catch(E){if(typeof s>"u"||E.name!=="ErrnoError")throw E;return E.u}},fd_seek:function(e,t,r,o){t=-9007199254740992>t||9007199254740992<t?NaN:Number(t);try{if(isNaN(t))return 61;var i=Q(e);return s.D(i,t,r),We[o>>3]=BigInt(i.position),i.ea&&t===0&&r===0&&(i.ea=null),0}catch(c){if(typeof s>"u"||c.name!=="ErrnoError")throw c;return c.u}},fd_write:function(e,t,r,o){try{e:{var i=Q(e);e=t;for(var c,m=t=0;m<r;m++){var w=z[e>>2],F=z[e+4>>2];e+=8;var v=s.write(i,Y,w,F,c);if(0>v){var A=-1;break e}t+=v,typeof c<"u"&&(c+=v)}A=t}return z[o>>2]=A,0}catch(E){if(typeof s>"u"||E.name!=="ErrnoError")throw E;return E.u}},invoke_vii:wr,strftime:(e,t,r,o)=>{function i(h,O,S){for(h=typeof h=="number"?h.toString():h||"";h.length<O;)h=S[0]+h;return h}function c(h,O){return i(h,O,"0")}function m(h,O){function S(G){return 0>G?-1:0<G?1:0}var I;return(I=S(h.getFullYear()-O.getFullYear()))===0&&(I=S(h.getMonth()-O.getMonth()))===0&&(I=S(h.getDate()-O.getDate())),I}function w(h){switch(h.getDay()){case 0:return new Date(h.getFullYear()-1,11,29);case 1:return h;case 2:return new Date(h.getFullYear(),0,3);case 3:return new Date(h.getFullYear(),0,2);case 4:return new Date(h.getFullYear(),0,1);case 5:return new Date(h.getFullYear()-1,11,31);case 6:return new Date(h.getFullYear()-1,11,30)}}function F(h){var O=h.O;for(h=new Date(new Date(h.P+1900,0,1).getTime());0<O;){var S=h.getMonth(),I=(Re(h.getFullYear())?hn:mn)[S];if(O>I-h.getDate())O-=I-h.getDate()+1,h.setDate(1),11>S?h.setMonth(S+1):(h.setMonth(0),h.setFullYear(h.getFullYear()+1));else{h.setDate(h.getDate()+O);break}}return S=new Date(h.getFullYear()+1,0,4),O=w(new Date(h.getFullYear(),0,4)),S=w(S),0>=m(O,h)?0>=m(S,h)?h.getFullYear()+1:h.getFullYear():h.getFullYear()-1}var v=z[o+40>>2];o={Va:k[o>>2],Ua:k[o+4>>2],$:k[o+8>>2],la:k[o+12>>2],aa:k[o+16>>2],P:k[o+20>>2],H:k[o+24>>2],O:k[o+28>>2],wb:k[o+32>>2],Ta:k[o+36>>2],Wa:v?re(v):""},r=re(r),v={"%c":"%a %b %d %H:%M:%S %Y","%D":"%m/%d/%y","%F":"%Y-%m-%d","%h":"%b","%r":"%I:%M:%S %p","%R":"%H:%M","%T":"%H:%M:%S","%x":"%m/%d/%y","%X":"%H:%M:%S","%Ec":"%c","%EC":"%C","%Ex":"%m/%d/%y","%EX":"%H:%M:%S","%Ey":"%y","%EY":"%Y","%Od":"%d","%Oe":"%e","%OH":"%H","%OI":"%I","%Om":"%m","%OM":"%M","%OS":"%S","%Ou":"%u","%OU":"%U","%OV":"%V","%Ow":"%w","%OW":"%W","%Oy":"%y"};for(var A in v)r=r.replace(new RegExp(A,"g"),v[A]);var E="Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),B="January February March April May June July August September October November December".split(" ");v={"%a":h=>E[h.H].substring(0,3),"%A":h=>E[h.H],"%b":h=>B[h.aa].substring(0,3),"%B":h=>B[h.aa],"%C":h=>c((h.P+1900)/100|0,2),"%d":h=>c(h.la,2),"%e":h=>i(h.la,2," "),"%g":h=>F(h).toString().substring(2),"%G":h=>F(h),"%H":h=>c(h.$,2),"%I":h=>(h=h.$,h==0?h=12:12<h&&(h-=12),c(h,2)),"%j":h=>{for(var O=0,S=0;S<=h.aa-1;O+=(Re(h.P+1900)?hn:mn)[S++]);return c(h.la+O,3)},"%m":h=>c(h.aa+1,2),"%M":h=>c(h.Ua,2),"%n":()=>`
`,"%p":h=>0<=h.$&&12>h.$?"AM":"PM","%S":h=>c(h.Va,2),"%t":()=>"	","%u":h=>h.H||7,"%U":h=>c(Math.floor((h.O+7-h.H)/7),2),"%V":h=>{var O=Math.floor((h.O+7-(h.H+6)%7)/7);if(2>=(h.H+371-h.O-2)%7&&O++,O)O==53&&(S=(h.H+371-h.O)%7,S==4||S==3&&Re(h.P)||(O=1));else{O=52;var S=(h.H+7-h.O-1)%7;(S==4||S==5&&Re(h.P%400-1))&&O++}return c(O,2)},"%w":h=>h.H,"%W":h=>c(Math.floor((h.O+7-(h.H+6)%7)/7),2),"%y":h=>(h.P+1900).toString().substring(2),"%Y":h=>h.P+1900,"%z":h=>{h=h.Ta;var O=0<=h;return h=Math.abs(h)/60,(O?"+":"-")+("0000"+(h/60*100+h%60)).slice(-4)},"%Z":h=>h.Wa,"%%":()=>"%"},r=r.replace(/%%/g,"\0\0");for(A in v)r.includes(A)&&(r=r.replace(new RegExp(A,"g"),v[A](o)));return r=r.replace(/\0\0/g,"%"),A=Ge(r,!1),A.length>t?0:(pn(A,e),A.length-1)},system:e=>{if(P){if(!e)return 1;if(e=re(e),!e.length)return 0;e=Le("child_process").ub(e,[],{tb:!0,stdio:"inherit"});var t=(r,o)=>r<<8|o;return e.status===null?t(0,(r=>{switch(r){case"SIGHUP":return 1;case"SIGQUIT":return 3;case"SIGFPE":return 8;case"SIGKILL":return 9;case"SIGALRM":return 14;case"SIGTERM":return 15}return 2})(e.signal)):e.status<<8|0}return e?(k[Mt()>>2]=52,-1):0}},be=(function(){var e={env:_n,wasi_snapshot_preview1:_n};ht("wasm-instantiate");var t=a;return rr(e,function(r){b(a===t,"the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?"),t=null,be=r.instance.exports,De=be.memory,b(De,"memory not found in wasm exports"),Ct(),J=be.__indirect_function_table,b(J,"table not found in wasm exports"),dt.unshift(be.__wasm_call_ctors),Ye("wasm-instantiate")}).catch(l),{}})();a._lua_checkstack=d("lua_checkstack"),a._lua_xmove=d("lua_xmove"),a._lua_atpanic=d("lua_atpanic"),a._lua_version=d("lua_version"),a._lua_absindex=d("lua_absindex"),a._lua_gettop=d("lua_gettop"),a._lua_settop=d("lua_settop"),a._lua_closeslot=d("lua_closeslot"),a._lua_rotate=d("lua_rotate"),a._lua_copy=d("lua_copy"),a._lua_pushvalue=d("lua_pushvalue"),a._lua_type=d("lua_type"),a._lua_typename=d("lua_typename"),a._lua_iscfunction=d("lua_iscfunction"),a._lua_isinteger=d("lua_isinteger"),a._lua_isnumber=d("lua_isnumber"),a._lua_isstring=d("lua_isstring"),a._lua_isuserdata=d("lua_isuserdata"),a._lua_rawequal=d("lua_rawequal"),a._lua_arith=d("lua_arith"),a._lua_compare=d("lua_compare"),a._lua_stringtonumber=d("lua_stringtonumber"),a._lua_tonumberx=d("lua_tonumberx"),a._lua_tointegerx=d("lua_tointegerx"),a._lua_toboolean=d("lua_toboolean"),a._lua_tolstring=d("lua_tolstring"),a._lua_rawlen=d("lua_rawlen"),a._lua_tocfunction=d("lua_tocfunction"),a._lua_touserdata=d("lua_touserdata"),a._lua_tothread=d("lua_tothread"),a._lua_topointer=d("lua_topointer"),a._lua_pushnil=d("lua_pushnil"),a._lua_pushnumber=d("lua_pushnumber"),a._lua_pushinteger=d("lua_pushinteger"),a._lua_pushlstring=d("lua_pushlstring"),a._lua_pushstring=d("lua_pushstring"),a._lua_pushcclosure=d("lua_pushcclosure"),a._lua_pushboolean=d("lua_pushboolean"),a._lua_pushlightuserdata=d("lua_pushlightuserdata"),a._lua_pushthread=d("lua_pushthread"),a._lua_getglobal=d("lua_getglobal"),a._lua_gettable=d("lua_gettable"),a._lua_getfield=d("lua_getfield"),a._lua_geti=d("lua_geti"),a._lua_rawget=d("lua_rawget"),a._lua_rawgeti=d("lua_rawgeti"),a._lua_rawgetp=d("lua_rawgetp"),a._lua_createtable=d("lua_createtable"),a._lua_getmetatable=d("lua_getmetatable"),a._lua_getiuservalue=d("lua_getiuservalue"),a._lua_setglobal=d("lua_setglobal"),a._lua_settable=d("lua_settable"),a._lua_setfield=d("lua_setfield"),a._lua_seti=d("lua_seti"),a._lua_rawset=d("lua_rawset"),a._lua_rawsetp=d("lua_rawsetp"),a._lua_rawseti=d("lua_rawseti"),a._lua_setmetatable=d("lua_setmetatable"),a._lua_setiuservalue=d("lua_setiuservalue"),a._lua_callk=d("lua_callk"),a._lua_pcallk=d("lua_pcallk"),a._lua_load=d("lua_load"),a._lua_dump=d("lua_dump"),a._lua_status=d("lua_status"),a._lua_error=d("lua_error"),a._lua_next=d("lua_next"),a._lua_toclose=d("lua_toclose"),a._lua_concat=d("lua_concat"),a._lua_len=d("lua_len"),a._lua_getallocf=d("lua_getallocf"),a._lua_setallocf=d("lua_setallocf"),a._lua_setwarnf=d("lua_setwarnf"),a._lua_warning=d("lua_warning"),a._lua_newuserdatauv=d("lua_newuserdatauv"),a._lua_getupvalue=d("lua_getupvalue"),a._lua_setupvalue=d("lua_setupvalue"),a._lua_upvalueid=d("lua_upvalueid"),a._lua_upvaluejoin=d("lua_upvaluejoin"),a._luaL_traceback=d("luaL_traceback"),a._lua_getstack=d("lua_getstack"),a._lua_getinfo=d("lua_getinfo"),a._luaL_buffinit=d("luaL_buffinit"),a._luaL_addstring=d("luaL_addstring"),a._luaL_prepbuffsize=d("luaL_prepbuffsize"),a._luaL_addvalue=d("luaL_addvalue"),a._luaL_pushresult=d("luaL_pushresult"),a._luaL_argerror=d("luaL_argerror"),a._luaL_typeerror=d("luaL_typeerror"),a._luaL_getmetafield=d("luaL_getmetafield"),a._luaL_where=d("luaL_where"),a._luaL_fileresult=d("luaL_fileresult");var Mt=d("__errno_location");a._luaL_execresult=d("luaL_execresult"),a._luaL_newmetatable=d("luaL_newmetatable"),a._luaL_setmetatable=d("luaL_setmetatable"),a._luaL_testudata=d("luaL_testudata"),a._luaL_checkudata=d("luaL_checkudata"),a._luaL_optlstring=d("luaL_optlstring"),a._luaL_checklstring=d("luaL_checklstring"),a._luaL_checkstack=d("luaL_checkstack"),a._luaL_checktype=d("luaL_checktype"),a._luaL_checkany=d("luaL_checkany"),a._luaL_checknumber=d("luaL_checknumber"),a._luaL_optnumber=d("luaL_optnumber"),a._luaL_checkinteger=d("luaL_checkinteger"),a._luaL_optinteger=d("luaL_optinteger"),a._luaL_setfuncs=d("luaL_setfuncs"),a._luaL_addlstring=d("luaL_addlstring"),a._luaL_pushresultsize=d("luaL_pushresultsize"),a._luaL_buffinitsize=d("luaL_buffinitsize"),a._luaL_ref=d("luaL_ref"),a._luaL_unref=d("luaL_unref"),a._luaL_loadfilex=d("luaL_loadfilex"),a._luaL_loadbufferx=d("luaL_loadbufferx"),a._luaL_loadstring=d("luaL_loadstring"),a._luaL_callmeta=d("luaL_callmeta"),a._luaL_len=d("luaL_len"),a._luaL_tolstring=d("luaL_tolstring"),a._luaL_getsubtable=d("luaL_getsubtable"),a._luaL_requiref=d("luaL_requiref"),a._luaL_addgsub=d("luaL_addgsub"),a._luaL_gsub=d("luaL_gsub"),a._luaL_newstate=d("luaL_newstate"),a._lua_newstate=d("lua_newstate"),a._free=d("free"),a._realloc=d("realloc");var bn=a._fflush=d("fflush");a._luaL_checkversion_=d("luaL_checkversion_"),a._luaopen_base=d("luaopen_base"),a._luaopen_coroutine=d("luaopen_coroutine"),a._lua_newthread=d("lua_newthread"),a._lua_yieldk=d("lua_yieldk"),a._lua_isyieldable=d("lua_isyieldable"),a._lua_resetthread=d("lua_resetthread"),a._lua_resume=d("lua_resume"),a._luaopen_debug=d("luaopen_debug"),a._lua_gethookmask=d("lua_gethookmask"),a._lua_gethook=d("lua_gethook"),a._lua_gethookcount=d("lua_gethookcount"),a._lua_getlocal=d("lua_getlocal"),a._lua_sethook=d("lua_sethook"),a._lua_setlocal=d("lua_setlocal"),a._lua_setcstacklimit=d("lua_setcstacklimit");var _r=a._malloc=d("malloc");a._luaL_openlibs=d("luaL_openlibs"),a._luaopen_package=d("luaopen_package"),a._luaopen_table=d("luaopen_table"),a._luaopen_io=d("luaopen_io"),a._luaopen_os=d("luaopen_os"),a._luaopen_string=d("luaopen_string"),a._luaopen_math=d("luaopen_math"),a._luaopen_utf8=d("luaopen_utf8"),a._lua_close=d("lua_close");var br=d("setThrew"),wn=()=>(wn=be.emscripten_stack_init)(),At=()=>(At=be.emscripten_stack_get_end)(),vn=d("stackSave"),yn=d("stackRestore"),kn=d("stackAlloc");function wr(e,t,r){var o=vn();try{St(e)(t,r)}catch(i){if(yn(o),i!==i+0)throw i;br(1,0)}}a.ENV=Qe,a.ccall=(e,t,r,o)=>{var i={string:v=>{var A=0;if(v!=null&&v!==0){A=Ae(v)+1;var E=kn(A);Ze(v,E,A),A=E}return A},array:v=>{var A=kn(v.length);return pn(v,A),A}};e=gr(e);var c=[],m=0;if(b(t!=="array",'Return type should not be "array".'),o)for(var w=0;w<o.length;w++){var F=i[r[w]];F?(m===0&&(m=vn()),c[w]=F(o[w])):c[w]=o[w]}return r=e.apply(null,c),r=(function(v){return m!==0&&yn(m),t==="string"?re(v):t==="boolean"?!!v:v})(r)},a.addFunction=(e,t)=>{if(b(typeof e<"u"),!_e){_e=new WeakMap;var r=J.length;if(_e)for(var o=0;o<0+r;o++){var i=St(o);i&&_e.set(i,o)}}if(r=_e.get(e)||0)return r;if(Ot.length)r=Ot.pop();else{try{J.grow(1)}catch(w){throw w instanceof RangeError?"Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.":w}r=J.length-1}try{o=r,J.set(o,e),ge[o]=J.get(o)}catch(w){if(!(w instanceof TypeError))throw w;if(b(typeof t<"u","Missing signature argument to addFunction: "+e),typeof WebAssembly.Function=="function"){o=WebAssembly.Function,i={i:"i32",j:"i64",f:"f32",d:"f64",e:"externref",p:"i32"};for(var c={parameters:[],results:t[0]=="v"?[]:[i[t[0]]]},m=1;m<t.length;++m)b(t[m]in i,"invalid signature char: "+t[m]),c.parameters.push(i[t[m]]);t=new o(c,e)}else{for(o=[1],i=t.slice(0,1),t=t.slice(1),c={i:127,p:127,j:126,f:125,d:124,e:111},o.push(96),m=t.length,b(16384>m),128>m?o.push(m):o.push(m%128|128,m>>7),m=0;m<t.length;++m)b(t[m]in c,"invalid signature char: "+t[m]),o.push(c[t[m]]);i=="v"?o.push(0):o.push(1,c[i]),t=[0,97,115,109,1,0,0,0,1],i=o.length,b(16384>i),128>i?t.push(i):t.push(i%128|128,i>>7),t.push.apply(t,o),t.push(2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0),t=new WebAssembly.Module(new Uint8Array(t)),t=new WebAssembly.Instance(t,{e:{f:e}}).exports.f}o=r,J.set(o,t),ge[o]=J.get(o)}return _e.set(e,r),r},a.removeFunction=e=>{_e.delete(St(e)),J.set(e,null),ge[e]=J.get(e),Ot.push(e)},a.setValue=function(e,t,r="i8"){switch(r.endsWith("*")&&(r="*"),r){case"i1":Y[e>>0]=t;break;case"i8":Y[e>>0]=t;break;case"i16":xe[e>>1]=t;break;case"i32":k[e>>2]=t;break;case"i64":We[e>>3]=BigInt(t);break;case"float":it[e>>2]=t;break;case"double":lt[e>>3]=t;break;case"*":z[e>>2]=t;break;default:$(`invalid type for setValue: ${r}`)}},a.getValue=function(e,t="i8"){switch(t.endsWith("*")&&(t="*"),t){case"i1":return Y[e>>0];case"i8":return Y[e>>0];case"i16":return xe[e>>1];case"i32":return k[e>>2];case"i64":return We[e>>3];case"float":return it[e>>2];case"double":return lt[e>>3];case"*":return z[e>>2];default:$(`invalid type for getValue: ${t}`)}},a.stringToUTF8=Ze,a.lengthBytesUTF8=Ae,a.stringToNewUTF8=Tt,a.FS=s,"writeI53ToI64 writeI53ToI64Clamped writeI53ToI64Signaling writeI53ToU64Clamped writeI53ToU64Signaling readI53FromI64 readI53FromU64 convertI32PairToI53 convertI32PairToI53Checked convertU32PairToI53 inetPton4 inetNtop4 inetPton6 inetNtop6 readSockaddr writeSockaddr getHostByName getCallstack emscriptenLog convertPCtoSourceLocation readEmAsmArgs jstoi_q jstoi_s listenOnce autoResumeAudioContext getDynCaller dynCall handleException runtimeKeepalivePush runtimeKeepalivePop callUserCallback maybeExit asmjsMangle handleAllocatorInit HandleAllocator getNativeTypeSize STACK_SIZE STACK_ALIGN POINTER_SIZE ASSERTIONS cwrap reallyNegative unSign strLen reSign formatString intArrayToString AsciiToString UTF16ToString stringToUTF16 lengthBytesUTF16 UTF32ToString stringToUTF32 lengthBytesUTF32 registerKeyEventCallback maybeCStringToJsString findEventTarget findCanvasEventTarget getBoundingClientRect fillMouseEventData registerMouseEventCallback registerWheelEventCallback registerUiEventCallback registerFocusEventCallback fillDeviceOrientationEventData registerDeviceOrientationEventCallback fillDeviceMotionEventData registerDeviceMotionEventCallback screenOrientation fillOrientationChangeEventData registerOrientationChangeEventCallback fillFullscreenChangeEventData registerFullscreenChangeEventCallback JSEvents_requestFullscreen JSEvents_resizeCanvasForFullscreen registerRestoreOldStyle hideEverythingExceptGivenElement restoreHiddenElements setLetterbox softFullscreenResizeWebGLRenderTarget doRequestFullscreen fillPointerlockChangeEventData registerPointerlockChangeEventCallback registerPointerlockErrorEventCallback requestPointerLock fillVisibilityChangeEventData registerVisibilityChangeEventCallback registerTouchEventCallback fillGamepadEventData registerGamepadEventCallback registerBeforeUnloadEventCallback fillBatteryEventData battery registerBatteryEventCallback setCanvasElementSize getCanvasElementSize jsStackTrace stackTrace checkWasiClock wasiRightsToMuslOFlags wasiOFlagsToMuslOFlags createDyncallWrapper safeSetTimeout setImmediateWrapped clearImmediateWrapped polyfillSetImmediate getPromise makePromise idsToPromises makePromiseCallback setMainLoop getSocketFromFD getSocketAddress FS_unlink FS_mkdirTree _setNetworkCallback".split(" ").forEach(function(e){typeof globalThis>"u"||Object.getOwnPropertyDescriptor(globalThis,e)||Object.defineProperty(globalThis,e,{configurable:!0,get(){var t=`\`${e}\` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line`,r=e;r.startsWith("_")||(r="$"+e),t+=` (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='${r}')`,Wt(e)&&(t+=". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you"),Oe(t)}}),Gt(e)}),"run addOnPreRun addOnInit addOnPreMain addOnExit addOnPostRun addRunDependency removeRunDependency FS_createFolder FS_createPath FS_createLazyFile FS_createLink FS_createDevice FS_readFile out err callMain abort wasmMemory wasmExports stackAlloc stackSave stackRestore getTempRet0 setTempRet0 writeStackCookie checkStackCookie MAX_INT53 MIN_INT53 bigintToI53Checked ptrToString zeroMemory exitJS getHeapMax growMemory MONTH_DAYS_REGULAR MONTH_DAYS_LEAP MONTH_DAYS_REGULAR_CUMULATIVE MONTH_DAYS_LEAP_CUMULATIVE isLeapYear ydayFromDate arraySum addDays ERRNO_CODES ERRNO_MESSAGES setErrNo DNS Protocols Sockets initRandomFill randomFill timers warnOnce UNWIND_CACHE readEmAsmArgsArray getExecutableName keepRuntimeAlive asyncLoad alignMemory mmapAlloc wasmTable noExitRuntime getCFunc uleb128Encode sigToWasmTypes generateFuncType convertJsFunctionToWasm freeTableIndexes functionsInTableMap getEmptyTableSlot updateTableMap getFunctionAddress PATH PATH_FS UTF8Decoder UTF8ArrayToString UTF8ToString stringToUTF8Array intArrayFromString stringToAscii UTF16Decoder stringToUTF8OnStack writeArrayToMemory JSEvents specialHTMLTargets currentFullscreenStrategy restoreOldWindowedStyle demangle demangleAll ExitStatus getEnvStrings doReadv doWritev promiseMap Browser wget SYSCALLS preloadPlugins FS_createPreloadedFile FS_modeStringToFlags FS_getMode FS_stdin_getChar_buffer FS_stdin_getChar FS_createDataFile MEMFS TTY PIPEFS SOCKFS".split(" ").forEach(Gt);var et;Ce=function e(){et||En(),et||(Ce=e)};function En(){if(!(0<Ne)){wn();var e=At();if(b((e&3)==0),e==0&&(e+=4),z[e>>2]=34821223,z[e+4>>2]=2310721022,z[0]=1668509029,a.preRun)for(typeof a.preRun=="function"&&(a.preRun=[a.preRun]);a.preRun.length;)e=a.preRun.shift(),ct.unshift(e);for(;0<ct.length;)ct.shift()(a);if(!(0<Ne)){if(!et&&(et=!0,a.calledRun=!0,!Ie)){for(b(!ft),ft=!0,ut(),a.noFSInit||s.R.Y||s.R(),s.ta=!1;0<dt.length;)dt.shift()(a);for(u(a),b(!a._main,'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]'),ut();0<zt.length;)zt.shift()(a)}ut()}}}function vr(){var e=Te,t=q,r=!1;Te=q=()=>{r=!0};try{bn(0),["stdout","stderr"].forEach(function(o){(o=un("/dev/"+o))&&(o=bt[o.object.rdev])&&o.output&&o.output.length&&(r=!0)})}catch{}Te=e,q=t,r&&Oe("stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.")}return En(),n.ready})})();class He{static async initialize(n,a){let u=await Qn({locateFile:(l,p)=>n||p+l,preRun:l=>{typeof a=="object"&&Object.entries(a).forEach(([p,y])=>l.ENV[p]=y)}});return new He(u)}constructor(n){this.referenceTracker=new WeakMap,this.referenceMap=new Map,this.availableReferences=[],this.module=n,this.luaL_checkversion_=this.cwrap("luaL_checkversion_",null,["number","number","number"]),this.luaL_getmetafield=this.cwrap("luaL_getmetafield","number",["number","number","string"]),this.luaL_callmeta=this.cwrap("luaL_callmeta","number",["number","number","string"]),this.luaL_tolstring=this.cwrap("luaL_tolstring","string",["number","number","number"]),this.luaL_argerror=this.cwrap("luaL_argerror","number",["number","number","string"]),this.luaL_typeerror=this.cwrap("luaL_typeerror","number",["number","number","string"]),this.luaL_checklstring=this.cwrap("luaL_checklstring","string",["number","number","number"]),this.luaL_optlstring=this.cwrap("luaL_optlstring","string",["number","number","string","number"]),this.luaL_checknumber=this.cwrap("luaL_checknumber","number",["number","number"]),this.luaL_optnumber=this.cwrap("luaL_optnumber","number",["number","number","number"]),this.luaL_checkinteger=this.cwrap("luaL_checkinteger","number",["number","number"]),this.luaL_optinteger=this.cwrap("luaL_optinteger","number",["number","number","number"]),this.luaL_checkstack=this.cwrap("luaL_checkstack",null,["number","number","string"]),this.luaL_checktype=this.cwrap("luaL_checktype",null,["number","number","number"]),this.luaL_checkany=this.cwrap("luaL_checkany",null,["number","number"]),this.luaL_newmetatable=this.cwrap("luaL_newmetatable","number",["number","string"]),this.luaL_setmetatable=this.cwrap("luaL_setmetatable",null,["number","string"]),this.luaL_testudata=this.cwrap("luaL_testudata","number",["number","number","string"]),this.luaL_checkudata=this.cwrap("luaL_checkudata","number",["number","number","string"]),this.luaL_where=this.cwrap("luaL_where",null,["number","number"]),this.luaL_fileresult=this.cwrap("luaL_fileresult","number",["number","number","string"]),this.luaL_execresult=this.cwrap("luaL_execresult","number",["number","number"]),this.luaL_ref=this.cwrap("luaL_ref","number",["number","number"]),this.luaL_unref=this.cwrap("luaL_unref",null,["number","number","number"]),this.luaL_loadfilex=this.cwrap("luaL_loadfilex","number",["number","string","string"]),this.luaL_loadbufferx=this.cwrap("luaL_loadbufferx","number",["number","string|number","number","string|number","string"]),this.luaL_loadstring=this.cwrap("luaL_loadstring","number",["number","string"]),this.luaL_newstate=this.cwrap("luaL_newstate","number",[]),this.luaL_len=this.cwrap("luaL_len","number",["number","number"]),this.luaL_addgsub=this.cwrap("luaL_addgsub",null,["number","string","string","string"]),this.luaL_gsub=this.cwrap("luaL_gsub","string",["number","string","string","string"]),this.luaL_setfuncs=this.cwrap("luaL_setfuncs",null,["number","number","number"]),this.luaL_getsubtable=this.cwrap("luaL_getsubtable","number",["number","number","string"]),this.luaL_traceback=this.cwrap("luaL_traceback",null,["number","number","string","number"]),this.luaL_requiref=this.cwrap("luaL_requiref",null,["number","string","number","number"]),this.luaL_buffinit=this.cwrap("luaL_buffinit",null,["number","number"]),this.luaL_prepbuffsize=this.cwrap("luaL_prepbuffsize","string",["number","number"]),this.luaL_addlstring=this.cwrap("luaL_addlstring",null,["number","string","number"]),this.luaL_addstring=this.cwrap("luaL_addstring",null,["number","string"]),this.luaL_addvalue=this.cwrap("luaL_addvalue",null,["number"]),this.luaL_pushresult=this.cwrap("luaL_pushresult",null,["number"]),this.luaL_pushresultsize=this.cwrap("luaL_pushresultsize",null,["number","number"]),this.luaL_buffinitsize=this.cwrap("luaL_buffinitsize","string",["number","number","number"]),this.lua_newstate=this.cwrap("lua_newstate","number",["number","number"]),this.lua_close=this.cwrap("lua_close",null,["number"]),this.lua_newthread=this.cwrap("lua_newthread","number",["number"]),this.lua_resetthread=this.cwrap("lua_resetthread","number",["number"]),this.lua_atpanic=this.cwrap("lua_atpanic","number",["number","number"]),this.lua_version=this.cwrap("lua_version","number",["number"]),this.lua_absindex=this.cwrap("lua_absindex","number",["number","number"]),this.lua_gettop=this.cwrap("lua_gettop","number",["number"]),this.lua_settop=this.cwrap("lua_settop",null,["number","number"]),this.lua_pushvalue=this.cwrap("lua_pushvalue",null,["number","number"]),this.lua_rotate=this.cwrap("lua_rotate",null,["number","number","number"]),this.lua_copy=this.cwrap("lua_copy",null,["number","number","number"]),this.lua_checkstack=this.cwrap("lua_checkstack","number",["number","number"]),this.lua_xmove=this.cwrap("lua_xmove",null,["number","number","number"]),this.lua_isnumber=this.cwrap("lua_isnumber","number",["number","number"]),this.lua_isstring=this.cwrap("lua_isstring","number",["number","number"]),this.lua_iscfunction=this.cwrap("lua_iscfunction","number",["number","number"]),this.lua_isinteger=this.cwrap("lua_isinteger","number",["number","number"]),this.lua_isuserdata=this.cwrap("lua_isuserdata","number",["number","number"]),this.lua_type=this.cwrap("lua_type","number",["number","number"]),this.lua_typename=this.cwrap("lua_typename","string",["number","number"]),this.lua_tonumberx=this.cwrap("lua_tonumberx","number",["number","number","number"]),this.lua_tointegerx=this.cwrap("lua_tointegerx","number",["number","number","number"]),this.lua_toboolean=this.cwrap("lua_toboolean","number",["number","number"]),this.lua_tolstring=this.cwrap("lua_tolstring","string",["number","number","number"]),this.lua_rawlen=this.cwrap("lua_rawlen","number",["number","number"]),this.lua_tocfunction=this.cwrap("lua_tocfunction","number",["number","number"]),this.lua_touserdata=this.cwrap("lua_touserdata","number",["number","number"]),this.lua_tothread=this.cwrap("lua_tothread","number",["number","number"]),this.lua_topointer=this.cwrap("lua_topointer","number",["number","number"]),this.lua_arith=this.cwrap("lua_arith",null,["number","number"]),this.lua_rawequal=this.cwrap("lua_rawequal","number",["number","number","number"]),this.lua_compare=this.cwrap("lua_compare","number",["number","number","number","number"]),this.lua_pushnil=this.cwrap("lua_pushnil",null,["number"]),this.lua_pushnumber=this.cwrap("lua_pushnumber",null,["number","number"]),this.lua_pushinteger=this.cwrap("lua_pushinteger",null,["number","number"]),this.lua_pushlstring=this.cwrap("lua_pushlstring","string",["number","string|number","number"]),this.lua_pushstring=this.cwrap("lua_pushstring","string",["number","string|number"]),this.lua_pushcclosure=this.cwrap("lua_pushcclosure",null,["number","number","number"]),this.lua_pushboolean=this.cwrap("lua_pushboolean",null,["number","number"]),this.lua_pushlightuserdata=this.cwrap("lua_pushlightuserdata",null,["number","number"]),this.lua_pushthread=this.cwrap("lua_pushthread","number",["number"]),this.lua_getglobal=this.cwrap("lua_getglobal","number",["number","string"]),this.lua_gettable=this.cwrap("lua_gettable","number",["number","number"]),this.lua_getfield=this.cwrap("lua_getfield","number",["number","number","string"]),this.lua_geti=this.cwrap("lua_geti","number",["number","number","number"]),this.lua_rawget=this.cwrap("lua_rawget","number",["number","number"]),this.lua_rawgeti=this.cwrap("lua_rawgeti","number",["number","number","number"]),this.lua_rawgetp=this.cwrap("lua_rawgetp","number",["number","number","number"]),this.lua_createtable=this.cwrap("lua_createtable",null,["number","number","number"]),this.lua_newuserdatauv=this.cwrap("lua_newuserdatauv","number",["number","number","number"]),this.lua_getmetatable=this.cwrap("lua_getmetatable","number",["number","number"]),this.lua_getiuservalue=this.cwrap("lua_getiuservalue","number",["number","number","number"]),this.lua_setglobal=this.cwrap("lua_setglobal",null,["number","string"]),this.lua_settable=this.cwrap("lua_settable",null,["number","number"]),this.lua_setfield=this.cwrap("lua_setfield",null,["number","number","string"]),this.lua_seti=this.cwrap("lua_seti",null,["number","number","number"]),this.lua_rawset=this.cwrap("lua_rawset",null,["number","number"]),this.lua_rawseti=this.cwrap("lua_rawseti",null,["number","number","number"]),this.lua_rawsetp=this.cwrap("lua_rawsetp",null,["number","number","number"]),this.lua_setmetatable=this.cwrap("lua_setmetatable","number",["number","number"]),this.lua_setiuservalue=this.cwrap("lua_setiuservalue","number",["number","number","number"]),this.lua_callk=this.cwrap("lua_callk",null,["number","number","number","number","number"]),this.lua_pcallk=this.cwrap("lua_pcallk","number",["number","number","number","number","number","number"]),this.lua_load=this.cwrap("lua_load","number",["number","number","number","string","string"]),this.lua_dump=this.cwrap("lua_dump","number",["number","number","number","number"]),this.lua_yieldk=this.cwrap("lua_yieldk","number",["number","number","number","number"]),this.lua_resume=this.cwrap("lua_resume","number",["number","number","number","number"]),this.lua_status=this.cwrap("lua_status","number",["number"]),this.lua_isyieldable=this.cwrap("lua_isyieldable","number",["number"]),this.lua_setwarnf=this.cwrap("lua_setwarnf",null,["number","number","number"]),this.lua_warning=this.cwrap("lua_warning",null,["number","string","number"]),this.lua_error=this.cwrap("lua_error","number",["number"]),this.lua_next=this.cwrap("lua_next","number",["number","number"]),this.lua_concat=this.cwrap("lua_concat",null,["number","number"]),this.lua_len=this.cwrap("lua_len",null,["number","number"]),this.lua_stringtonumber=this.cwrap("lua_stringtonumber","number",["number","string"]),this.lua_getallocf=this.cwrap("lua_getallocf","number",["number","number"]),this.lua_setallocf=this.cwrap("lua_setallocf",null,["number","number","number"]),this.lua_toclose=this.cwrap("lua_toclose",null,["number","number"]),this.lua_closeslot=this.cwrap("lua_closeslot",null,["number","number"]),this.lua_getstack=this.cwrap("lua_getstack","number",["number","number","number"]),this.lua_getinfo=this.cwrap("lua_getinfo","number",["number","string","number"]),this.lua_getlocal=this.cwrap("lua_getlocal","string",["number","number","number"]),this.lua_setlocal=this.cwrap("lua_setlocal","string",["number","number","number"]),this.lua_getupvalue=this.cwrap("lua_getupvalue","string",["number","number","number"]),this.lua_setupvalue=this.cwrap("lua_setupvalue","string",["number","number","number"]),this.lua_upvalueid=this.cwrap("lua_upvalueid","number",["number","number","number"]),this.lua_upvaluejoin=this.cwrap("lua_upvaluejoin",null,["number","number","number","number","number"]),this.lua_sethook=this.cwrap("lua_sethook",null,["number","number","number","number"]),this.lua_gethook=this.cwrap("lua_gethook","number",["number"]),this.lua_gethookmask=this.cwrap("lua_gethookmask","number",["number"]),this.lua_gethookcount=this.cwrap("lua_gethookcount","number",["number"]),this.lua_setcstacklimit=this.cwrap("lua_setcstacklimit","number",["number","number"]),this.luaopen_base=this.cwrap("luaopen_base","number",["number"]),this.luaopen_coroutine=this.cwrap("luaopen_coroutine","number",["number"]),this.luaopen_table=this.cwrap("luaopen_table","number",["number"]),this.luaopen_io=this.cwrap("luaopen_io","number",["number"]),this.luaopen_os=this.cwrap("luaopen_os","number",["number"]),this.luaopen_string=this.cwrap("luaopen_string","number",["number"]),this.luaopen_utf8=this.cwrap("luaopen_utf8","number",["number"]),this.luaopen_math=this.cwrap("luaopen_math","number",["number"]),this.luaopen_debug=this.cwrap("luaopen_debug","number",["number"]),this.luaopen_package=this.cwrap("luaopen_package","number",["number"]),this.luaL_openlibs=this.cwrap("luaL_openlibs",null,["number"])}lua_remove(n,a){this.lua_rotate(n,a,-1),this.lua_pop(n,1)}lua_pop(n,a){this.lua_settop(n,-a-1)}luaL_getmetatable(n,a){return this.lua_getfield(n,j,a)}lua_yield(n,a){return this.lua_yieldk(n,a,0,null)}lua_upvalueindex(n){return j-n}ref(n){let a=this.referenceTracker.get(n);if(a)return a.refCount++,a.index;let u=this.availableReferences.pop(),l=u===void 0?this.referenceMap.size+1:u;return this.referenceMap.set(l,n),this.referenceTracker.set(n,{refCount:1,index:l}),this.lastRefIndex=l,l}unref(n){let a=this.referenceMap.get(n);if(a===void 0)return;let u=this.referenceTracker.get(a);if(u===void 0){this.referenceTracker.delete(a),this.availableReferences.push(n);return}u.refCount--,u.refCount<=0&&(this.referenceTracker.delete(a),this.referenceMap.delete(n),this.availableReferences.push(n))}getRef(n){return this.referenceMap.get(n)}getLastRefIndex(){return this.lastRefIndex}printRefs(){for(let[n,a]of this.referenceMap.entries())console.log(n,a)}cwrap(n,a,u){return u.some(p=>p==="string|number")?(...p)=>{let y=[],M=u.map((L,D)=>{var P;if(L==="string|number"){if(typeof p[D]=="number")return"number";if(((P=p[D])===null||P===void 0?void 0:P.length)>1024){let N=this.module.stringToNewUTF8(p[D]);return p[D]=N,y.push(N),"number"}else return"string"}return L});try{return this.module.ccall(n,a,M,p)}finally{for(let L of y)this.module._free(L)}}:(...p)=>this.module.ccall(n,a,u,p)}}var er="1.16.0";class tr{constructor(n,a){var u;n===void 0&&(typeof window=="object"&&typeof window.document<"u"||typeof self=="object"&&((u=self?.constructor)===null||u===void 0?void 0:u.name)==="DedicatedWorkerGlobalScope")&&(n=`https://unpkg.com/wasmoon@${er}/dist/glue.wasm`),this.luaWasmPromise=He.initialize(n,a)}async mountFile(n,a){this.mountFileSync(await this.getLuaModule(),n,a)}mountFileSync(n,a,u){let l=a.lastIndexOf("/"),p=a.substring(l+1),y=a.substring(0,a.length-p.length-1);if(y.length>0){let M=y.split("/").reverse(),L="";for(;M.length;){let D=M.pop();if(!D)continue;let P=`${L}/${D}`;try{n.module.FS.mkdir(P)}catch{}L=P}}n.module.FS.writeFile(a,u)}async createEngine(n={}){return new It(await this.getLuaModule(),n)}async getLuaModule(){return this.luaWasmPromise}}f.Decoration=H,f.LUAI_MAXSTACK=U,f.LUA_MULTRET=C,f.LUA_REGISTRYINDEX=j,f.LuaEngine=It,f.LuaFactory=tr,f.LuaGlobal=Pt,f.LuaMultiReturn=we,f.LuaRawResult=je,f.LuaThread=ve,f.LuaTimeoutError=ae,f.LuaTypeExtension=ue,f.LuaWasm=He,f.PointerSize=x,f.decorate=K,f.decorateFunction=at,f.decorateProxy=Dt,f.decorateUserdata=Xn}))});var Nn=Sr(An(),1);var Fn=`--
-- MobDebug -- Lua remote debugger
-- Copyright 2011-23 Paul Kulchenko
-- Based on RemDebug 1.0 Copyright Kepler Project 2005
--

-- use loaded modules or load explicitly on those systems that require that
local require = require
local io = io or require "io"
local table = table or require "table"
local string = string or require "string"
local coroutine = coroutine or require "coroutine"
local debug = require "debug"
-- protect require "os" as it may fail on embedded systems without os module
local os = os or (function(module)
  local ok, res = pcall(require, module)
  return ok and res or nil
end)("os")

local mobdebug = {
  _NAME = "mobdebug",
  _VERSION = "0.805",
  _COPYRIGHT = "Paul Kulchenko",
  _DESCRIPTION = "Mobile Remote Debugger for the Lua programming language",
  port = os and os.getenv and tonumber((os.getenv("MOBDEBUG_PORT"))) or 8172,
  checkcount = 200,
  yieldtimeout = 0.02, -- yield timeout (s)
  connecttimeout = 2, -- connect timeout (s)
}

local HOOKMASK = "lcr"
local error = error
local getfenv = getfenv
local setfenv = setfenv
local loadstring = loadstring or load -- "load" replaced "loadstring" in Lua 5.2
local pairs = pairs
local setmetatable = setmetatable
local tonumber = tonumber
local unpack = table.unpack or unpack
local rawget = rawget
local gsub, sub, find = string.gsub, string.sub, string.find

-- if strict.lua is used, then need to avoid referencing some global
-- variables, as they can be undefined;
-- use rawget to avoid complaints from strict.lua at run-time.
-- it's safe to do the initialization here as all these variables
-- should get defined values (if any) before the debugging starts.
-- there is also global 'wx' variable, which is checked as part of
-- the debug loop as 'wx' can be loaded at any time during debugging.
local genv = _G or _ENV
local jit = rawget(genv, "jit")
local MOAICoroutine = rawget(genv, "MOAICoroutine")

-- ngx_lua/Openresty requires special handling as its coroutine.*
-- methods use a different mechanism that doesn't allow resume calls
-- from debug hook handlers.
-- Instead, the "original" coroutine.* methods are used.
-- \`rawget\` needs to be used to protect against \`strict\` checks
local ngx = rawget(genv, "ngx")
if not ngx then
  -- "older" versions of ngx_lua (0.10.x at least) hide ngx table in metatable,
  -- so need to use that
  local metagindex = getmetatable(genv) and getmetatable(genv).__index
  ngx = type(metagindex) == "table" and metagindex.rawget and metagindex:rawget("ngx") or nil
end
local corocreate = ngx and coroutine._create or coroutine.create
local cororesume = ngx and coroutine._resume or coroutine.resume
local coroyield = ngx and coroutine._yield or coroutine.yield
local corostatus = ngx and coroutine._status or coroutine.status
local corowrap = coroutine.wrap

if not setfenv then -- Lua 5.2+
  -- based on http://lua-users.org/lists/lua-l/2010-06/msg00314.html
  -- this assumes f is a function
  local function findenv(f)
    if not debug.getupvalue then return nil end
    local level = 1
    repeat
      local name, value = debug.getupvalue(f, level)
      if name == '_ENV' then return level, value end
      level = level + 1
    until name == nil
    return nil end
  getfenv = function (f) return(select(2, findenv(f)) or _G) end
  setfenv = function (f, t)
    local level = findenv(f)
    if level then debug.setupvalue(f, level, t) end
    return f end
end

-- check for OS and convert file names to lower case on windows
-- (its file system is case insensitive, but case preserving), as setting a
-- breakpoint on x:\\Foo.lua will not work if the file was loaded as X:\\foo.lua.
-- OSX and Windows behave the same way (case insensitive, but case preserving).
-- OSX can be configured to be case-sensitive, so check for that. This doesn't
-- handle the case of different partitions having different case-sensitivity.
local win = os and os.getenv and (os.getenv('WINDIR') or (os.getenv('OS') or ''):match('[Ww]indows')) and true or false
local mac = not win and (os and os.getenv and os.getenv('DYLD_LIBRARY_PATH') or not io.open("/proc")) and true or false
local iscasepreserving = win or (mac and io.open('/library') ~= nil)

-- turn jit off based on Mike Pall's comment in this discussion:
-- http://www.freelists.org/post/luajit/Debug-hooks-and-JIT,2
-- "You need to turn it off at the start if you plan to receive
-- reliable hook calls at any later point in time."
if jit and jit.off then jit.off() end

local socket = require "socket"
local coro_debugger
local coro_debugee
local coroutines = {}; setmetatable(coroutines, {__mode = "k"}) -- "weak" keys
local events = { BREAK = 1, WATCH = 2, RESTART = 3, STACK = 4 }
local breakpoints = {}
local watches = {}
local lastsource
local lastfile
local watchescnt = 0
local abort -- default value is nil; this is used in start/loop distinction
local seen_hook = false
local checkcount = 0
local step_into = false
local step_over = false
local step_level = 0
local stack_level = 0
local SAFEWS = "\\012" -- "safe" whitespace value
local server
local buf
local outputs = {}
local iobase = {print = print}
local basedir = ""
local deferror = "execution aborted at default debugee"
local debugee = function ()
  local a = 1
  for _ = 1, 10 do a = a + 1 end
  error(deferror)
end
local function q(s) return string.gsub(s, '([%(%)%.%%%+%-%*%?%[%^%$%]])','%%%1') end

local serpent = (function() ---- include Serpent module for serialization
local n, v = "serpent", "0.302" -- (C) 2012-18 Paul Kulchenko; MIT License
local c, d = "Paul Kulchenko", "Lua serializer and pretty printer"
local snum = {[tostring(1/0)]='1/0 --[[math.huge]]',[tostring(-1/0)]='-1/0 --[[-math.huge]]',[tostring(0/0)]='0/0'}
local badtype = {thread = true, userdata = true, cdata = true}
local getmetatable = debug and debug.getmetatable or getmetatable
local pairs = function(t) return next, t end -- avoid using __pairs in Lua 5.2+
local keyword, globals, G = {}, {}, (_G or _ENV)
for _,k in ipairs({'and', 'break', 'do', 'else', 'elseif', 'end', 'false',
  'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
  'return', 'then', 'true', 'until', 'while'}) do keyword[k] = true end
for k,v in pairs(G) do globals[v] = k end -- build func to name mapping
for _,g in ipairs({'coroutine', 'debug', 'io', 'math', 'string', 'table', 'os'}) do
  for k,v in pairs(type(G[g]) == 'table' and G[g] or {}) do globals[v] = g..'.'..k end end

local function s(t, opts)
  local name, indent, fatal, maxnum = opts.name, opts.indent, opts.fatal, opts.maxnum
  local sparse, custom, huge = opts.sparse, opts.custom, not opts.nohuge
  local space, maxl = (opts.compact and '' or ' '), (opts.maxlevel or math.huge)
  local maxlen, metatostring = tonumber(opts.maxlength), opts.metatostring
  local iname, comm = '_'..(name or ''), opts.comment and (tonumber(opts.comment) or math.huge)
  local numformat = opts.numformat or "%.17g"
  local seen, sref, syms, symn = {}, {'local '..iname..'={}'}, {}, 0
  local function gensym(val) return '_'..(tostring(tostring(val)):gsub("[^%w]",""):gsub("(%d%w+)",
    -- tostring(val) is needed because __tostring may return a non-string value
    function(s) if not syms[s] then symn = symn+1; syms[s] = symn end return tostring(syms[s]) end)) end
  local function safestr(s) return type(s) == "number" and tostring(huge and snum[tostring(s)] or numformat:format(s))
    or type(s) ~= "string" and tostring(s) -- escape NEWLINE/010 and EOF/026
    or ("%q"):format(s):gsub("\\010","n"):gsub("\\026","\\\\026") end
  local function comment(s,l) return comm and (l or 0) < comm and ' --[['..select(2, pcall(tostring, s))..']]' or '' end
  local function globerr(s,l) return globals[s] and globals[s]..comment(s,l) or not fatal
    and safestr(select(2, pcall(tostring, s))) or error("Can't serialize "..tostring(s)) end
  local function safename(path, name) -- generates foo.bar, foo[3], or foo['b a r']
    local n = name == nil and '' or name
    local plain = type(n) == "string" and n:match("^[%l%u_][%w_]*$") and not keyword[n]
    local safe = plain and n or '['..safestr(n)..']'
    return (path or '')..(plain and path and '.' or '')..safe, safe end
  local alphanumsort = type(opts.sortkeys) == 'function' and opts.sortkeys or function(k, o, n) -- k=keys, o=originaltable, n=padding
    local maxn, to = tonumber(n) or 12, {number = 'a', string = 'b'}
    local function padnum(d) return ("%0"..tostring(maxn).."d"):format(tonumber(d)) end
    table.sort(k, function(a,b)
      -- sort numeric keys first: k[key] is not nil for numerical keys
      return (k[a] ~= nil and 0 or to[type(a)] or 'z')..(tostring(a):gsub("%d+",padnum))
           < (k[b] ~= nil and 0 or to[type(b)] or 'z')..(tostring(b):gsub("%d+",padnum)) end) end
  local function val2str(t, name, indent, insref, path, plainindex, level)
    local ttype, level, mt = type(t), (level or 0), getmetatable(t)
    local spath, sname = safename(path, name)
    local tag = plainindex and
      ((type(name) == "number") and '' or name..space..'='..space) or
      (name ~= nil and sname..space..'='..space or '')
    if seen[t] then -- already seen this element
      sref[#sref+1] = spath..space..'='..space..seen[t]
      return tag..'nil'..comment('ref', level) end
    -- protect from those cases where __tostring may fail
    if type(mt) == 'table' and metatostring ~= false then
      local to, tr = pcall(function() return mt.__tostring(t) end)
      local so, sr = pcall(function() return mt.__serialize(t) end)
      if (to or so) then -- knows how to serialize itself
        seen[t] = insref or spath
        t = so and sr or tr
        ttype = type(t)
      end -- new value falls through to be serialized
    end
    if ttype == "table" then
      if level >= maxl then return tag..'{}'..comment('maxlvl', level) end
      seen[t] = insref or spath
      if next(t) == nil then return tag..'{}'..comment(t, level) end -- table empty
      if maxlen and maxlen < 0 then return tag..'{}'..comment('maxlen', level) end
      local maxn, o, out = math.min(#t, maxnum or #t), {}, {}
      for key = 1, maxn do o[key] = key end
      if not maxnum or #o < maxnum then
        local n = #o -- n = n + 1; o[n] is much faster than o[#o+1] on large tables
        for key in pairs(t) do if o[key] ~= key then n = n + 1; o[n] = key end end end
      if maxnum and #o > maxnum then o[maxnum+1] = nil end
      if opts.sortkeys and #o > maxn then alphanumsort(o, t, opts.sortkeys) end
      local sparse = sparse and #o > maxn -- disable sparsness if only numeric keys (shorter output)
      for n, key in ipairs(o) do
        local value, ktype, plainindex = t[key], type(key), n <= maxn and not sparse
        if opts.valignore and opts.valignore[value] -- skip ignored values; do nothing
        or opts.keyallow and not opts.keyallow[key]
        or opts.keyignore and opts.keyignore[key]
        or opts.valtypeignore and opts.valtypeignore[type(value)] -- skipping ignored value types
        or sparse and value == nil then -- skipping nils; do nothing
        elseif ktype == 'table' or ktype == 'function' or badtype[ktype] then
          if not seen[key] and not globals[key] then
            sref[#sref+1] = 'placeholder'
            local sname = safename(iname, gensym(key)) -- iname is table for local variables
            sref[#sref] = val2str(key,sname,indent,sname,iname,true) end
          sref[#sref+1] = 'placeholder'
          local path = seen[t]..'['..tostring(seen[key] or globals[key] or gensym(key))..']'
          sref[#sref] = path..space..'='..space..tostring(seen[value] or val2str(value,nil,indent,path))
        else
          out[#out+1] = val2str(value,key,indent,nil,seen[t],plainindex,level+1)
          if maxlen then
            maxlen = maxlen - #out[#out]
            if maxlen < 0 then break end
          end
        end
      end
      local prefix = string.rep(indent or '', level)
      local head = indent and '{\\n'..prefix..indent or '{'
      local body = table.concat(out, ','..(indent and '\\n'..prefix..indent or space))
      local tail = indent and "\\n"..prefix..'}' or '}'
      return (custom and custom(tag,head,body,tail,level) or tag..head..body..tail)..comment(t, level)
    elseif badtype[ttype] then
      seen[t] = insref or spath
      return tag..globerr(t, level)
    elseif ttype == 'function' then
      seen[t] = insref or spath
      if opts.nocode then return tag.."function() --[[..skipped..]] end"..comment(t, level) end
      local ok, res = pcall(string.dump, t)
      local func = ok and "((loadstring or load)("..safestr(res)..",'@serialized'))"..comment(t, level)
      return tag..(func or globerr(t, level))
    else return tag..safestr(t) end -- handle all other types
  end
  local sepr = indent and "\\n" or ";"..space
  local body = val2str(t, name, indent) -- this call also populates sref
  local tail = #sref>1 and table.concat(sref, sepr)..sepr or ''
  local warn = opts.comment and #sref>1 and space.."--[[incomplete output with shared/self-references skipped]]" or ''
  return not name and body..warn or "do local "..body..sepr..tail.."return "..name..sepr.."end"
end

local function deserialize(data, opts)
  local env = (opts and opts.safe == false) and G
    or setmetatable({}, {
        __index = function(t,k) return t end,
        __call = function(t,...) error("cannot call functions") end
      })
  local f, res = (loadstring or load)('return '..data, nil, nil, env)
  if not f then f, res = (loadstring or load)(data, nil, nil, env) end
  if not f then return f, res end
  if setfenv then setfenv(f, env) end
  return pcall(f)
end

local function merge(a, b) if b then for k,v in pairs(b) do a[k] = v end end; return a; end
return { _NAME = n, _COPYRIGHT = c, _DESCRIPTION = d, _VERSION = v, serialize = s,
  load = deserialize,
  dump = function(a, opts) return s(a, merge({name = '_', compact = true, sparse = true}, opts)) end,
  line = function(a, opts) return s(a, merge({sortkeys = true, comment = true}, opts)) end,
  block = function(a, opts) return s(a, merge({indent = '  ', sortkeys = true, comment = true}, opts)) end }
end)() ---- end of Serpent module

mobdebug.line = serpent.line
mobdebug.dump = serpent.dump
mobdebug.linemap = nil
mobdebug.loadstring = loadstring

local function removebasedir(path, basedir)
  if iscasepreserving then
    -- check if the lowercased path matches the basedir
    -- if so, return substring of the original path (to not lowercase it)
    return path:lower():find('^'..q(basedir:lower()))
      and path:sub(#basedir+1) or path
  else
    return string.gsub(path, '^'..q(basedir), '')
  end
end

local function stack(start)
  local function vars(f)
    local func = debug.getinfo(f, "f").func
    local i = 1
    local locals = {}
    -- get locals
    while true do
      local name, value = debug.getlocal(f, i)
      if not name then break end
      if string.sub(name, 1, 1) ~= '(' then
        locals[name] = {value, select(2,pcall(tostring,value))}
      end
      i = i + 1
    end
    -- get varargs (these use negative indices)
    i = 1
    while true do
      local name, value = debug.getlocal(f, -i)
      if not name then break end
      locals[name:gsub("%)$"," "..i..")")] = {value, select(2,pcall(tostring,value))}
      i = i + 1
    end
    -- get upvalues
    i = 1
    local ups = {}
    while func and debug.getupvalue do -- check for func as it may be nil for tail calls
      local name, value = debug.getupvalue(func, i)
      if not name then break end
      ups[name] = {value, select(2,pcall(tostring,value))}
      i = i + 1
    end
    return locals, ups
  end

  local stack = {}
  local linemap = mobdebug.linemap
  for i = (start or 0), 100 do
    local source = debug.getinfo(i, "Snl")
    if not source then break end

    local src = source.source
    if src:find("@") == 1 then
      src = src:sub(2):gsub("\\\\", "/")
      if src:find("%./") == 1 then src = src:sub(3) end
    end

    table.insert(stack, { -- remove basedir from source
      {source.name, removebasedir(src, basedir),
       linemap and linemap(source.linedefined, source.source) or source.linedefined,
       linemap and linemap(source.currentline, source.source) or source.currentline,
       source.what, source.namewhat, source.short_src},
      vars(i+1)})
  end
  return stack
end

local function set_breakpoint(file, line)
  if file == '-' and lastfile then file = lastfile
  elseif iscasepreserving then file = string.lower(file) end
  if not breakpoints[line] then breakpoints[line] = {} end
  breakpoints[line][file] = true
end

local function remove_breakpoint(file, line)
  if file == '-' and lastfile then file = lastfile
  elseif file == '*' and line == 0 then breakpoints = {}
  elseif iscasepreserving then file = string.lower(file) end
  if breakpoints[line] then breakpoints[line][file] = nil end
end

local function has_breakpoint(file, line)
  return breakpoints[line]
     and breakpoints[line][iscasepreserving and string.lower(file) or file]
end

local function restore_vars(vars)
  if type(vars) ~= 'table' then return end

  -- locals need to be processed in the reverse order, starting from
  -- the inner block out, to make sure that the localized variables
  -- are correctly updated with only the closest variable with
  -- the same name being changed
  -- first loop find how many local variables there is, while
  -- the second loop processes them from i to 1
  local i = 1
  while true do
    local name = debug.getlocal(3, i)
    if not name then break end
    i = i + 1
  end
  i = i - 1
  local written_vars = {}
  while i > 0 do
    local name = debug.getlocal(3, i)
    if not written_vars[name] then
      if string.sub(name, 1, 1) ~= '(' then
        debug.setlocal(3, i, rawget(vars, name))
      end
      written_vars[name] = true
    end
    i = i - 1
  end

  i = 1
  local func = debug.getinfo(3, "f").func
  while debug.getupvalue do
    local name = debug.getupvalue(func, i)
    if not name then break end
    if not written_vars[name] then
      if string.sub(name, 1, 1) ~= '(' then
        debug.setupvalue(func, i, rawget(vars, name))
      end
      written_vars[name] = true
    end
    i = i + 1
  end
end

local function capture_vars(level, thread)
  level = (level or 0)+2 -- add two levels for this and debug calls
  local func = (thread and debug.getinfo(thread, level, "f") or debug.getinfo(level, "f") or {}).func
  if not func then return {} end

  local vars = {['...'] = {}}
  local i = 1
  while debug.getupvalue do
    local name, value = debug.getupvalue(func, i)
    if not name then break end
    if string.sub(name, 1, 1) ~= '(' then vars[name] = value end
    i = i + 1
  end
  i = 1
  while true do
    local name, value
    if thread then
      name, value = debug.getlocal(thread, level, i)
    else
      name, value = debug.getlocal(level, i)
    end
    if not name then break end
    if string.sub(name, 1, 1) ~= '(' then vars[name] = value end
    i = i + 1
  end
  -- get varargs (these use negative indices)
  i = 1
  while true do
    local name, value
    if thread then
      name, value = debug.getlocal(thread, level, -i)
    else
      name, value = debug.getlocal(level, -i)
    end
    if not name then break end
    vars['...'][i] = value
    i = i + 1
  end
  -- returned 'vars' table plays a dual role: (1) it captures local values
  -- and upvalues to be restored later (in case they are modified in "eval"),
  -- and (2) it provides an environment for evaluated chunks.
  -- getfenv(func) is needed to provide proper environment for functions,
  -- including access to globals, but this causes vars[name] to fail in
  -- restore_vars on local variables or upvalues with \`nil\` values when
  -- 'strict' is in effect. To avoid this \`rawget\` is used in restore_vars.
  setmetatable(vars, { __index = getfenv(func), __newindex = getfenv(func), __mode = "v" })
  return vars
end

local function stack_depth(start_depth)
  for i = start_depth, 0, -1 do
    if debug.getinfo(i, "l") then return i+1 end
  end
  return start_depth
end

local function is_safe(stack_level)
  -- the stack grows up: 0 is getinfo, 1 is is_safe, 2 is debug_hook, 3 is user function
  if stack_level == 3 then return true end
  for i = 3, stack_level do
    -- return if it is not safe to abort
    local info = debug.getinfo(i, "S")
    if not info then return true end
    if info.what == "C" then return false end
  end
  return true
end

local function in_debugger()
  local this = debug.getinfo(1, "S").source
  -- only need to check few frames as mobdebug frames should be close
  for i = 3, 7 do
    local info = debug.getinfo(i, "S")
    if not info then return false end
    if info.source == this then return true end
  end
  return false
end

local function is_pending(peer)
  -- if there is something already in the buffer, skip check
  if not buf and checkcount >= mobdebug.checkcount then
    peer:settimeout(0) -- non-blocking
    buf = peer:receive(1)
    peer:settimeout() -- back to blocking
    checkcount = 0
  end
  return buf
end

local function readnext(peer, num)
  peer:settimeout(0) -- non-blocking
  local res, err, partial = peer:receive(num)
  peer:settimeout() -- back to blocking
  return res or partial or '', err
end

local function handle_breakpoint(peer)
  -- check if the buffer has the beginning of SETB/DELB command;
  -- this is to avoid reading the entire line for commands that
  -- don't need to be handled here.
  if not buf or not (buf:sub(1,1) == 'S' or buf:sub(1,1) == 'D') then return end

  -- check second character to avoid reading STEP or other S* and D* commands
  if #buf == 1 then buf = buf .. readnext(peer, 1) end
  if buf:sub(2,2) ~= 'E' then return end

  -- need to read few more characters
  buf = buf .. readnext(peer, 5-#buf)
  if buf ~= 'SETB ' and buf ~= 'DELB ' then return end

  local res, _, partial = peer:receive("*l") -- get the rest of the line; blocking
  if not res then
    if partial then buf = buf .. partial end
    return
  end

  local _, _, cmd, file, line = (buf..res):find("^([A-Z]+)%s+(.-)%s+(%d+)%s*$")
  if cmd == 'SETB' then set_breakpoint(file, tonumber(line))
  elseif cmd == 'DELB' then remove_breakpoint(file, tonumber(line))
  else
    -- this looks like a breakpoint command, but something went wrong;
    -- return here to let the "normal" processing to handle,
    -- although this is likely to not go well.
    return
  end

  buf = nil
end

local function normalize_path(file)
  local n
  repeat
    file, n = file:gsub("/+%.?/+","/") -- remove all \`//\` and \`/./\` references
  until n == 0
  -- collapse all up-dir references: this will clobber UNC prefix (\\\\?\\)
  -- and disk on Windows when there are too many up-dir references: \`D:\\foo\\..\\..\\bar\`;
  -- handle the case of multiple up-dir references: \`foo/bar/baz/../../../more\`;
  -- only remove one at a time as otherwise \`../../\` could be removed;
  repeat
    file, n = file:gsub("[^/]+/%.%./", "", 1)
  until n == 0
  -- there may still be a leading up-dir reference left (as \`/../\` or \`../\`); remove it
  return (file:gsub("^(/?)%.%./", "%1"))
end

local function debug_hook(event, line)
  -- (1) LuaJIT needs special treatment. Because debug_hook is set for
  -- *all* coroutines, and not just the one being debugged as in regular Lua
  -- (http://lua-users.org/lists/lua-l/2011-06/msg00513.html),
  -- need to avoid debugging mobdebug's own code as LuaJIT doesn't
  -- always correctly generate call/return hook events (there are more
  -- calls than returns, which breaks stack depth calculation and
  -- 'step' and 'step over' commands stop working; possibly because
  -- 'tail return' events are not generated by LuaJIT).
  -- the next line checks if the debugger is run under LuaJIT and if
  -- one of debugger methods is present in the stack, it simply returns.
  -- ngx_lua/Openresty requires a slightly different handling, as it
  -- creates a coroutine wrapper, so this processing needs to be skipped.
  if jit and not (ngx and type(ngx) == "table" and ngx.say) then
    -- when luajit is compiled with LUAJIT_ENABLE_LUA52COMPAT,
    -- coroutine.running() returns non-nil for the main thread.
    local coro, main = coroutine.running()
    if not coro or main then coro = 'main' end
    local disabled = coroutines[coro] == false
      or coroutines[coro] == nil and coro ~= (coro_debugee or 'main')
    if coro_debugee and disabled or not coro_debugee and (disabled or in_debugger()) then
      return
    end
  end

  -- (2) check if abort has been requested and it's safe to abort
  if abort and is_safe(stack_level) then error(abort) end

  -- (3) also check if this debug hook has not been visited for any reason.
  -- this check is needed to avoid stepping in too early
  -- (for example, when coroutine.resume() is executed inside start()).
  if not seen_hook and in_debugger() then return end

  if event == "call" then
    stack_level = stack_level + 1
  elseif event == "return" or event == "tail return" then
    stack_level = stack_level - 1
  elseif event == "line" then
    if mobdebug.linemap then
      local ok, mappedline = pcall(mobdebug.linemap, line, debug.getinfo(2, "S").source)
      if ok then line = mappedline end
      if not line then return end
    end

    -- may need to fall through because of the following:
    -- (1) step_into
    -- (2) step_over and stack_level <= step_level (need stack_level)
    -- (3) breakpoint; check for line first as it's known; then for file
    -- (4) socket call (only do every Xth check)
    -- (5) at least one watch is registered
    if not (
      step_into or step_over or breakpoints[line] or watchescnt > 0
      or is_pending(server)
    ) then checkcount = checkcount + 1; return end

    checkcount = mobdebug.checkcount -- force check on the next command

    -- this is needed to check if the stack got shorter or longer.
    -- unfortunately counting call/return calls is not reliable.
    -- the discrepancy may happen when "pcall(load, '')" call is made
    -- or when "error()" is called in a function.
    -- in either case there are more "call" than "return" events reported.
    -- this validation is done for every "line" event, but should be "cheap"
    -- as it checks for the stack to get shorter (or longer by one call).
    -- start from one level higher just in case we need to grow the stack.
    -- this may happen after coroutine.resume call to a function that doesn't
    -- have any other instructions to execute. it triggers three returns:
    -- "return, tail return, return", which needs to be accounted for.
    stack_level = stack_depth(stack_level+1)

    local caller = debug.getinfo(2, "S")

    -- grab the filename and fix it if needed
    local file = lastfile
    if (lastsource ~= caller.source) then
      file, lastsource = caller.source, caller.source
      -- technically, users can supply names that may not use '@',
      -- for example when they call loadstring('...', 'filename.lua').
      -- Unfortunately, there is no reliable/quick way to figure out
      -- what is the filename and what is the source code.
      -- If the name doesn't start with \`@\`, assume it's a file name if it's all on one line.
      if find(file, "^@") or not find(file, "[\\r\\n]") then
        file = gsub(gsub(file, "^@", ""), "\\\\", "/")
        -- normalize paths that may include up-dir or same-dir references
        -- if the path starts from the up-dir or reference,
        -- prepend \`basedir\` to generate absolute path to keep breakpoints working.
        -- ignore qualified relative path (\`D:../\`) and UNC paths (\`\\\\?\\\`)
        if find(file, "^%.%./") then file = basedir..file end
        if find(file, "/%.%.?/") then file = normalize_path(file) end
        -- need this conversion to be applied to relative and absolute
        -- file names as you may write "require 'Foo'" to
        -- load "foo.lua" (on a case insensitive file system) and breakpoints
        -- set on foo.lua will not work if not converted to the same case.
        if iscasepreserving then file = string.lower(file) end
        if find(file, "^%./") then file = sub(file, 3) end
        -- remove basedir, so that breakpoints are checked properly
        file = gsub(file, "^"..q(basedir), "")
        -- some file systems allow newlines in file names; remove these.
        file = gsub(file, "\\n", ' ')
      else
        file = mobdebug.line(file)
      end

      -- set to true if we got here; this only needs to be done once per
      -- session, so do it here to at least avoid setting it for every line.
      seen_hook = true
      lastfile = file
    end

    if is_pending(server) then handle_breakpoint(server) end

    local vars, status, res
    if (watchescnt > 0) then
      vars = capture_vars(1)
      for index, value in pairs(watches) do
        setfenv(value, vars)
        local ok, fired = pcall(value)
        if ok and fired then
          status, res = cororesume(coro_debugger, events.WATCH, vars, file, line, index)
          break -- any one watch is enough; don't check multiple times
        end
      end
    end

    -- need to get into the "regular" debug handler, but only if there was
    -- no watch that was fired. If there was a watch, handle its result.
    local getin = (status == nil) and
      (step_into
      -- when coroutine.running() return \`nil\` (main thread in Lua 5.1),
      -- step_over will equal 'main', so need to check for that explicitly.
      or (step_over and step_over == (coroutine.running() or 'main') and stack_level <= step_level)
      or has_breakpoint(file, line)
      or is_pending(server))

    if getin then
      vars = vars or capture_vars(1)
      step_into = false
      step_over = false
      status, res = cororesume(coro_debugger, events.BREAK, vars, file, line)
    end

    -- handle 'stack' command that provides stack() information to the debugger
    while status and res == 'stack' do
      -- resume with the stack trace and variables
      if vars then restore_vars(vars) end -- restore vars so they are reflected in stack values
      status, res = cororesume(coro_debugger, events.STACK, stack(3), file, line)
    end

    -- need to recheck once more as resume after 'stack' command may
    -- return something else (for example, 'exit'), which needs to be handled
    if status and res and res ~= 'stack' then
      if not abort and res == "exit" then mobdebug.onexit(1, true); return end
      if not abort and res == "done" then mobdebug.done(); return end
      abort = res
      -- only abort if safe; if not, there is another (earlier) check inside
      -- debug_hook, which will abort execution at the first safe opportunity
      if is_safe(stack_level) then error(abort) end
    elseif not status and res then
      error(res, 2) -- report any other (internal) errors back to the application
    end

    if vars then restore_vars(vars) end

    -- last command requested Step Over/Out; store the current thread
    if step_over == true then step_over = coroutine.running() or 'main' end
  end
end

local function stringify_results(params, status, ...)
  if not status then return status, ... end -- on error report as it

  params = params or {}
  if params.nocode == nil then params.nocode = true end
  if params.comment == nil then params.comment = 1 end

  local t = {}
  for i = 1, select('#', ...) do -- stringify each of the returned values
    local ok, res = pcall(mobdebug.line, select(i, ...), params)
    t[i] = ok and res or ("%q"):format(res):gsub("\\010","n"):gsub("\\026","\\\\026")
  end
  -- stringify table with all returned values
  -- this is done to allow each returned value to be used (serialized or not)
  -- intependently and to preserve "original" comments
  return pcall(mobdebug.dump, t, {sparse = false})
end

local function isrunning()
  return coro_debugger and (corostatus(coro_debugger) == 'suspended' or corostatus(coro_debugger) == 'running')
end

-- this is a function that removes all hooks and closes the socket to
-- report back to the controller that the debugging is done.
-- the script that called \`done\` can still continue.
local function done()
  if not (isrunning() and server) then return end

  if not jit then
    for co, debugged in pairs(coroutines) do
      if debugged then debug.sethook(co) end
    end
  end

  debug.sethook()
  server:close()

  coro_debugger = nil -- to make sure isrunning() returns \`false\`
  seen_hook = nil -- to make sure that the next start() call works
  abort = nil -- to make sure that callback calls use proper "abort" value
  basedir = "" -- to reset basedir in case the same module/state is reused
end

local function debugger_loop(sev, svars, sfile, sline)
  local command
  local eval_env = svars or {}
  local function emptyWatch () return false end
  local loaded = {}
  for k in pairs(package.loaded) do loaded[k] = true end

  while true do
    local line, err
    if mobdebug.yield and server.settimeout then server:settimeout(mobdebug.yieldtimeout) end
    while true do
      line, err = server:receive("*l")
      if not line then
        if err == "timeout" then
          if mobdebug.yield then mobdebug.yield() end
        elseif err == "closed" then
          error("Debugger connection closed", 0)
        else
          error(("Unexpected socket error: %s"):format(err), 0)
        end
      else
        -- if there is something in the pending buffer, prepend it to the line
        if buf then line = buf .. line; buf = nil end
        break
      end
    end
    if server.settimeout then server:settimeout() end -- back to blocking
    command = string.sub(line, string.find(line, "^[A-Z]+"))
    if command == "SETB" then
      local _, _, _, file, line = string.find(line, "^([A-Z]+)%s+(.-)%s+(%d+)%s*$")
      if file and line then
        set_breakpoint(file, tonumber(line))
        server:send("200 OK\\n")
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "DELB" then
      local _, _, _, file, line = string.find(line, "^([A-Z]+)%s+(.-)%s+(%d+)%s*$")
      if file and line then
        remove_breakpoint(file, tonumber(line))
        server:send("200 OK\\n")
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "EXEC" then
      -- extract any optional parameters
      local params = string.match(line, "--%s*(%b{})%s*$")
      local _, _, chunk = string.find(line, "^[A-Z]+%s+(.+)$")
      if chunk then
        -- \\r is optional, as it may be stripped by some luasocket versions, like the one in LOVE2d
        chunk = chunk:gsub("\\r?"..SAFEWS, "\\n") -- convert safe whitespace back to new line
        local func, res = mobdebug.loadstring(chunk)
        local status
        if func then
          local pfunc = params and loadstring("return "..params) -- use internal function
          params = pfunc and pfunc()
          params = (type(params) == "table" and params or {})
          local stack = tonumber(params.stack)
          -- if the requested stack frame is not the current one, then use a new capture
          -- with a specific stack frame: \`capture_vars(0, coro_debugee)\`
          local env = stack and coro_debugee and capture_vars(stack-1, coro_debugee) or eval_env
          setfenv(func, env)
          status, res = stringify_results(params, pcall(func, unpack(rawget(env,'...') or {})))
        end
        if status then
          if mobdebug.onscratch then mobdebug.onscratch(res) end
          server:send("200 OK " .. tostring(#res) .. "\\n")
          server:send(res)
        else
          -- fix error if not set (for example, when loadstring is not present)
          if not res then res = "Unknown error" end
          server:send("401 Error in Expression " .. tostring(#res) .. "\\n")
          server:send(res)
        end
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "LOAD" then
      local _, _, size, name = string.find(line, "^[A-Z]+%s+(%d+)%s+(%S.-)%s*$")
      size = tonumber(size)

      if abort == nil then -- no LOAD/RELOAD allowed inside start()
        if size > 0 then server:receive(size) end
        if sfile and sline then
          server:send("201 Started " .. sfile .. " " .. tostring(sline) .. "\\n")
        else
          server:send("200 OK 0\\n")
        end
      else
        -- reset environment to allow required modules to load again
        -- remove those packages that weren't loaded when debugger started
        for k in pairs(package.loaded) do
          if not loaded[k] then package.loaded[k] = nil end
        end

        if size == 0 and name == '-' then -- RELOAD the current script being debugged
          server:send("200 OK 0\\n")
          coroyield("load")
        else
          -- receiving 0 bytes blocks (at least in luasocket 2.0.2), so skip reading
          local chunk = size == 0 and "" or server:receive(size)
          if chunk then -- LOAD a new script for debugging
            local func, res = mobdebug.loadstring(chunk, "@"..name)
            if func then
              server:send("200 OK 0\\n")
              debugee = func
              coroyield("load")
            else
              server:send("401 Error in Expression " .. tostring(#res) .. "\\n")
              server:send(res)
            end
          else
            server:send("400 Bad Request\\n")
          end
        end
      end
    elseif command == "SETW" then
      local _, _, exp = string.find(line, "^[A-Z]+%s+(.+)%s*$")
      if exp then
        local func, res = mobdebug.loadstring("return(" .. exp .. ")")
        if func then
          watchescnt = watchescnt + 1
          local newidx = #watches + 1
          watches[newidx] = func
          server:send("200 OK " .. tostring(newidx) .. "\\n")
        else
          server:send("401 Error in Expression " .. tostring(#res) .. "\\n")
          server:send(res)
        end
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "DELW" then
      local _, _, index = string.find(line, "^[A-Z]+%s+(%d+)%s*$")
      index = tonumber(index)
      if index > 0 and index <= #watches then
        watchescnt = watchescnt - (watches[index] ~= emptyWatch and 1 or 0)
        watches[index] = emptyWatch
        server:send("200 OK\\n")
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "RUN" then
      server:send("200 OK\\n")

      local ev, vars, file, line, idx_watch = coroyield()
      eval_env = vars
      if ev == events.BREAK then
        server:send("202 Paused " .. file .. " " .. tostring(line) .. "\\n")
      elseif ev == events.WATCH then
        server:send("203 Paused " .. file .. " " .. tostring(line) .. " " .. tostring(idx_watch) .. "\\n")
      elseif ev == events.RESTART then
        -- nothing to do
      else
        server:send("401 Error in Execution " .. tostring(#file) .. "\\n")
        server:send(file)
      end
    elseif command == "STEP" then
      server:send("200 OK\\n")
      step_into = true

      local ev, vars, file, line, idx_watch = coroyield()
      eval_env = vars
      if ev == events.BREAK then
        server:send("202 Paused " .. file .. " " .. tostring(line) .. "\\n")
      elseif ev == events.WATCH then
        server:send("203 Paused " .. file .. " " .. tostring(line) .. " " .. tostring(idx_watch) .. "\\n")
      elseif ev == events.RESTART then
        -- nothing to do
      else
        server:send("401 Error in Execution " .. tostring(#file) .. "\\n")
        server:send(file)
      end
    elseif command == "OVER" or command == "OUT" then
      server:send("200 OK\\n")
      step_over = true

      -- OVER and OUT are very similar except for
      -- the stack level value at which to stop
      if command == "OUT" then step_level = stack_level - 1
      else step_level = stack_level end

      local ev, vars, file, line, idx_watch = coroyield()
      eval_env = vars
      if ev == events.BREAK then
        server:send("202 Paused " .. file .. " " .. tostring(line) .. "\\n")
      elseif ev == events.WATCH then
        server:send("203 Paused " .. file .. " " .. tostring(line) .. " " .. tostring(idx_watch) .. "\\n")
      elseif ev == events.RESTART then
        -- nothing to do
      else
        server:send("401 Error in Execution " .. tostring(#file) .. "\\n")
        server:send(file)
      end
    elseif command == "BASEDIR" then
      local _, _, dir = string.find(line, "^[A-Z]+%s+(.+)%s*$")
      if dir then
        basedir = iscasepreserving and string.lower(dir) or dir
        -- reset cached source as it may change with basedir
        lastsource = nil
        server:send("200 OK\\n")
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "SUSPEND" then
      -- do nothing; it already fulfilled its role
    elseif command == "DONE" then
      coroyield("done")
      return -- done with all the debugging
    elseif command == "STACK" then
      -- first check if we can execute the stack command
      -- as it requires yielding back to debug_hook it cannot be executed
      -- if we have not seen the hook yet as happens after start().
      -- in this case we simply return an empty result
      local vars, ev = {}
      if seen_hook then
        ev, vars = coroyield("stack")
      end
      if ev and ev ~= events.STACK then
        server:send("401 Error in Execution " .. tostring(#vars) .. "\\n")
        server:send(vars)
      else
        local params = string.match(line, "--%s*(%b{})%s*$")
        local pfunc = params and loadstring("return "..params) -- use internal function
        params = pfunc and pfunc()
        params = (type(params) == "table" and params or {})
        if params.nocode == nil then params.nocode = true end
        if params.sparse == nil then params.sparse = false end
        -- take into account additional levels for the stack frames and data management
        if tonumber(params.maxlevel) then params.maxlevel = tonumber(params.maxlevel)+4 end

        local ok, res = pcall(mobdebug.dump, vars, params)
        if ok then
          server:send("200 OK " .. tostring(res) .. "\\n")
        else
          server:send("401 Error in Execution " .. tostring(#res) .. "\\n")
          server:send(res)
        end
      end
    elseif command == "OUTPUT" then
      local _, _, stream, mode = string.find(line, "^[A-Z]+%s+(%w+)%s+([dcr])%s*$")
      if stream and mode and stream == "stdout" then
        -- assign "print" in the global environment
        local default = mode == 'd'
        genv.print = default and iobase.print or corowrap(function()
          -- wrapping into coroutine.wrap protects this function from
          -- being stepped through in the debugger.
          -- don't use vararg (...) as it adds a reference for its values,
          -- which may affect how they are garbage collected
          while true do
            local tbl = {coroutine.yield()}
            if mode == 'c' then iobase.print(unpack(tbl)) end
            for n = 1, #tbl do
              tbl[n] = select(2, pcall(mobdebug.line, tbl[n], {nocode = true, comment = false})) end
            local file = table.concat(tbl, "\\t").."\\n"
            server:send("204 Output " .. stream .. " " .. tostring(#file) .. "\\n" .. file)
          end
        end)
        if not default then genv.print() end -- "fake" print to start printing loop
        server:send("200 OK\\n")
      else
        server:send("400 Bad Request\\n")
      end
    elseif command == "EXIT" then
      server:send("200 OK\\n")
      coroyield("exit")
    else
      server:send("400 Bad Request\\n")
    end
  end
end

local function output(stream, data)
  if server then return server:send("204 Output "..stream.." "..tostring(#data).."\\n"..data) end
end

local function connect(controller_host, controller_port)
  local sock, err = socket.tcp()
  if not sock then return nil, err end

  if sock.settimeout then sock:settimeout(mobdebug.connecttimeout) end
  local res, err = sock:connect(controller_host, tostring(controller_port))
  if sock.settimeout then sock:settimeout() end

  if not res then return nil, err end
  return sock
end

local lasthost, lastport

-- Starts a debug session by connecting to a controller
local function start(controller_host, controller_port)
  -- only one debugging session can be run (as there is only one debug hook)
  if isrunning() then return end

  lasthost = controller_host or lasthost
  lastport = controller_port or lastport

  controller_host = lasthost or "localhost"
  controller_port = lastport or mobdebug.port

  local err
  server, err = mobdebug.connect(controller_host, controller_port)
  if server then
    -- correct stack depth which already has some calls on it
    -- so it doesn't go into negative when those calls return
    -- as this breaks subsequence checks in stack_depth().
    -- start from 16th frame, which is sufficiently large for this check.
    stack_level = stack_depth(16)

    coro_debugger = corocreate(debugger_loop)
    debug.sethook(debug_hook, HOOKMASK)
    seen_hook = nil -- reset in case the last start() call was refused
    step_into = true -- start with step command
    return true
  else
    print(("Could not connect to %s:%s: %s")
      :format(controller_host, controller_port, err or "unknown error"))
  end
end

local function controller(controller_host, controller_port, scratchpad)
  -- only one debugging session can be run (as there is only one debug hook)
  if isrunning() then return end

  lasthost = controller_host or lasthost
  lastport = controller_port or lastport

  controller_host = lasthost or "localhost"
  controller_port = lastport or mobdebug.port

  local exitonerror = not scratchpad
  local err
  server, err = mobdebug.connect(controller_host, controller_port)
  if server then
    local function report(trace, err)
      local msg = err .. "\\n" .. trace
      server:send("401 Error in Execution " .. tostring(#msg) .. "\\n")
      server:send(msg)
      return err
    end

    seen_hook = true -- allow to accept all commands
    coro_debugger = corocreate(debugger_loop)

    while true do
      step_into = true -- start with step command
      abort = false -- reset abort flag from the previous loop
      if scratchpad then checkcount = mobdebug.checkcount end -- force suspend right away

      coro_debugee = corocreate(debugee)
      debug.sethook(coro_debugee, debug_hook, HOOKMASK)
      local status, err = cororesume(coro_debugee, unpack(arg or {}))

      -- was there an error or is the script done?
      -- 'abort' state is allowed here; ignore it
      if abort then
        if tostring(abort) == 'exit' then break end
      else
        if status then -- no errors
          if corostatus(coro_debugee) == "suspended" then
            -- the script called \`coroutine.yield\` in the "main" thread
            error("attempt to yield from the main thread", 3)
          end
          break -- normal execution is done
        elseif err and not string.find(tostring(err), deferror) then
          -- report the error back
          -- err is not necessarily a string, so convert to string to report
          report(debug.traceback(coro_debugee), tostring(err))
          if exitonerror then break end
          -- check if the debugging is done (coro_debugger is nil)
          if not coro_debugger then break end
          -- resume once more to clear the response the debugger wants to send
          -- need to use capture_vars(0) to capture only two (default) levels,
          -- as even though there is controller() call, because of the tail call,
          -- the caller may not exist for it;
          -- This is not entirely safe as the user may see the local
          -- variable from console, but they will be reset anyway.
          -- This functionality is used when scratchpad is paused to
          -- gain access to remote console to modify global variables.
          local status, err = cororesume(coro_debugger, events.RESTART, capture_vars(0))
          if not status or status and err == "exit" then break end
        end
      end
    end
  else
    print(("Could not connect to %s:%s: %s")
      :format(controller_host, controller_port, err or "unknown error"))
    return false
  end
  return true
end

local function scratchpad(controller_host, controller_port)
  return controller(controller_host, controller_port, true)
end

local function loop(controller_host, controller_port)
  return controller(controller_host, controller_port, false)
end

local function on()
  if not (isrunning() and server) then return end

  -- main is set to true under Lua5.2 for the "main" chunk.
  -- Lua5.1 returns co as \`nil\` in that case.
  local co, main = coroutine.running()
  if main then co = nil end
  if co then
    coroutines[co] = true
    debug.sethook(co, debug_hook, HOOKMASK)
  else
    if jit then coroutines.main = true end
    debug.sethook(debug_hook, HOOKMASK)
  end
end

local function off()
  if not (isrunning() and server) then return end

  -- main is set to true under Lua5.2 for the "main" chunk.
  -- Lua5.1 returns co as \`nil\` in that case.
  local co, main = coroutine.running()
  if main then co = nil end

  -- don't remove coroutine hook under LuaJIT as there is only one (global) hook
  if co then
    coroutines[co] = false
    if not jit then debug.sethook(co) end
  else
    if jit then coroutines.main = false end
    if not jit then debug.sethook() end
  end

  -- check if there is any thread that is still being debugged under LuaJIT;
  -- if not, turn the debugging off
  if jit then
    local remove = true
    for _, debugged in pairs(coroutines) do
      if debugged then remove = false; break end
    end
    if remove then debug.sethook() end
  end
end

-- Handles server debugging commands
local function handle(params, client, options)
  -- when \`options.verbose\` is not provided, use normal \`print\`; verbose output can be
  -- disabled (\`options.verbose == false\`) or redirected (\`options.verbose == function()...end\`)
  local verbose = not options or options.verbose ~= nil and options.verbose
  local print = verbose and (type(verbose) == "function" and verbose or print) or function() end
  local file, line, watch_idx
  local _, _, command = string.find(params, "^([a-z]+)")
  if command == "run" or command == "step" or command == "out"
  or command == "over" or command == "exit" then
    client:send(string.upper(command) .. "\\n")
    client:receive("*l") -- this should consume the first '200 OK' response
    while true do
      local done = true
      local breakpoint = client:receive("*l")
      if not breakpoint then
        print("Program finished")
        return nil, nil, false
      end
      local _, _, status = string.find(breakpoint, "^(%d+)")
      if status == "200" then
        -- don't need to do anything
      elseif status == "202" then
        _, _, file, line = string.find(breakpoint, "^202 Paused%s+(.-)%s+(%d+)%s*$")
        if file and line then
          print("Paused at file " .. file .. " line " .. line)
        end
      elseif status == "203" then
        _, _, file, line, watch_idx = string.find(breakpoint, "^203 Paused%s+(.-)%s+(%d+)%s+(%d+)%s*$")
        if file and line and watch_idx then
          print("Paused at file " .. file .. " line " .. line .. " (watch expression " .. watch_idx .. ": [" .. watches[watch_idx] .. "])")
        end
      elseif status == "204" then
        local _, _, stream, size = string.find(breakpoint, "^204 Output (%w+) (%d+)$")
        if stream and size then
          local size = tonumber(size)
          local msg = size > 0 and client:receive(size) or ""
          print(msg)
          if outputs[stream] then outputs[stream](msg) end
          -- this was just the output, so go back reading the response
          done = false
        end
      elseif status == "401" then
        local _, _, size = string.find(breakpoint, "^401 Error in Execution (%d+)$")
        if size then
          local msg = client:receive(tonumber(size))
          print("Error in remote application: " .. msg)
          return nil, nil, msg
        end
      else
        print("Unknown error")
        return nil, nil, "Debugger error: unexpected response '" .. breakpoint .. "'"
      end
      if done then break end
    end
  elseif command == "done" then
    client:send(string.upper(command) .. "\\n")
    -- no response is expected
  elseif command == "setb" or command == "asetb" then
    _, _, _, file, line = string.find(params, "^([a-z]+)%s+(.-)%s+(%d+)%s*$")
    if file and line then
      -- if this is a file name, and not a file source
      if not file:find('^".*"$') then
        file = string.gsub(file, "\\\\", "/") -- convert slash
        file = removebasedir(file, basedir)
      end
      client:send("SETB " .. file .. " " .. line .. "\\n")
      if command == "asetb" or client:receive("*l") == "200 OK" then
        set_breakpoint(file, line)
      else
        print("Error: breakpoint not inserted")
      end
    else
      print("Invalid command")
    end
  elseif command == "setw" then
    local _, _, exp = string.find(params, "^[a-z]+%s+(.+)$")
    if exp then
      client:send("SETW " .. exp .. "\\n")
      local answer = client:receive("*l")
      local _, _, watch_idx = string.find(answer, "^200 OK (%d+)%s*$")
      if watch_idx then
        watches[watch_idx] = exp
        print("Inserted watch exp no. " .. watch_idx)
      else
        local _, _, size = string.find(answer, "^401 Error in Expression (%d+)$")
        if size then
          local err = client:receive(tonumber(size)):gsub(".-:%d+:%s*","")
          print("Error: watch expression not set: " .. err)
        else
          print("Error: watch expression not set")
        end
      end
    else
      print("Invalid command")
    end
  elseif command == "delb" or command == "adelb" then
    _, _, _, file, line = string.find(params, "^([a-z]+)%s+(.-)%s+(%d+)%s*$")
    if file and line then
      -- if this is a file name, and not a file source
      if not file:find('^".*"$') then
        file = string.gsub(file, "\\\\", "/") -- convert slash
        file = removebasedir(file, basedir)
      end
      client:send("DELB " .. file .. " " .. line .. "\\n")
      if command == "adelb" or client:receive("*l") == "200 OK" then
        remove_breakpoint(file, line)
      else
        print("Error: breakpoint not removed")
      end
    else
      print("Invalid command")
    end
  elseif command == "delallb" then
    local file, line = "*", 0
    client:send("DELB " .. file .. " " .. tostring(line) .. "\\n")
    if client:receive("*l") == "200 OK" then
      remove_breakpoint(file, line)
    else
      print("Error: all breakpoints not removed")
    end
  elseif command == "delw" then
    local _, _, index = string.find(params, "^[a-z]+%s+(%d+)%s*$")
    if index then
      client:send("DELW " .. index .. "\\n")
      if client:receive("*l") == "200 OK" then
        watches[index] = nil
      else
        print("Error: watch expression not removed")
      end
    else
      print("Invalid command")
    end
  elseif command == "delallw" then
    for index, exp in pairs(watches) do
      client:send("DELW " .. index .. "\\n")
      if client:receive("*l") == "200 OK" then
        watches[index] = nil
      else
        print("Error: watch expression at index " .. index .. " [" .. exp .. "] not removed")
      end
    end
  elseif command == "eval" or command == "exec"
      or command == "load" or command == "loadstring"
      or command == "reload" then
    local _, _, exp = string.find(params, "^[a-z]+%s+(.+)$")
    if exp or (command == "reload") then
      if command == "eval" or command == "exec" then
        exp = exp:gsub("\\r?\\n", "\\r"..SAFEWS) -- convert new lines, so the fragment can be passed as one line
        if command == "eval" then exp = "return " .. exp end
        client:send("EXEC " .. exp .. "\\n")
      elseif command == "reload" then
        client:send("LOAD 0 -\\n")
      elseif command == "loadstring" then
        local _, _, _, file, lines = string.find(exp, "^([\\"'])(.-)%1%s(.+)")
        if not file then
           _, _, file, lines = string.find(exp, "^(%S+)%s(.+)")
        end
        client:send("LOAD " .. tostring(#lines) .. " " .. file .. "\\n")
        client:send(lines)
      else
        local file = io.open(exp, "r")
        if not file and pcall(require, "winapi") then
          -- if file is not open and winapi is there, try with a short path;
          -- this may be needed for unicode paths on windows
          winapi.set_encoding(winapi.CP_UTF8)
          local shortp = winapi.short_path(exp)
          file = shortp and io.open(shortp, "r")
        end
        if not file then return nil, nil, "Cannot open file " .. exp end
        -- read the file and remove the shebang line as it causes a compilation error
        local lines = file:read("*all"):gsub("^#!.-\\n", "\\n")
        file:close()

        local fname = string.gsub(exp, "\\\\", "/") -- convert slash
        fname = removebasedir(fname, basedir)
        client:send("LOAD " .. tostring(#lines) .. " " .. fname .. "\\n")
        if #lines > 0 then client:send(lines) end
      end
      while true do
        local params, err = client:receive("*l")
        if not params then
          return nil, nil, "Debugger connection " .. (err or "error")
        end
        local done = true
        local _, _, status, len = string.find(params, "^(%d+).-%s+(%d+)%s*$")
        if status == "200" then
          len = tonumber(len)
          if len > 0 then
            local status, res
            local str = client:receive(len)
            -- handle serialized table with results
            local func, err = loadstring(str)
            if func then
              status, res = pcall(func)
              if not status then err = res
              elseif type(res) ~= "table" then
                err = "received "..type(res).." instead of expected 'table'"
              end
            end
            if err then
              print("Error in processing results: " .. err)
              return nil, nil, "Error in processing results: " .. err
            end
            print(unpack(res))
            return res[1], res
          end
        elseif status == "201" then
          _, _, file, line = string.find(params, "^201 Started%s+(.-)%s+(%d+)%s*$")
        elseif status == "202" or params == "200 OK" then
          -- do nothing; this only happens when RE/LOAD command gets the response
          -- that was for the original command that was aborted
        elseif status == "204" then
          local _, _, stream, size = string.find(params, "^204 Output (%w+) (%d+)$")
          if stream and size then
            local size = tonumber(size)
            local msg = size > 0 and client:receive(size) or ""
            print(msg)
            if outputs[stream] then outputs[stream](msg) end
            -- this was just the output, so go back reading the response
            done = false
          end
        elseif status == "401" then
          len = tonumber(len)
          local res = client:receive(len)
          print("Error in expression: " .. res)
          return nil, nil, res
        else
          print("Unknown error")
          return nil, nil, "Debugger error: unexpected response after EXEC/LOAD '" .. params .. "'"
        end
        if done then break end
      end
    else
      print("Invalid command")
    end
  elseif command == "listb" then
    for l, v in pairs(breakpoints) do
      for f in pairs(v) do
        print(f .. ": " .. l)
      end
    end
  elseif command == "listw" then
    for i, v in pairs(watches) do
      print("Watch exp. " .. i .. ": " .. v)
    end
  elseif command == "suspend" then
    client:send("SUSPEND\\n")
  elseif command == "stack" then
    local opts = string.match(params, "^[a-z]+%s+(.+)$")
    client:send("STACK" .. (opts and " "..opts or "") .."\\n")
    local resp = client:receive("*l")
    local _, _, status, res = string.find(resp, "^(%d+)%s+%w+%s+(.+)%s*$")
    if status == "200" then
      local func, err = loadstring(res)
      if func == nil then
        print("Error in stack information: " .. err)
        return nil, nil, err
      end
      local ok, stack = pcall(func)
      if not ok then
        print("Error in stack information: " .. stack)
        return nil, nil, stack
      end
      for _,frame in ipairs(stack) do
        print(mobdebug.line(frame[1], {comment = false}))
      end
      return stack
    elseif status == "401" then
      local _, _, len = string.find(resp, "%s+(%d+)%s*$")
      len = tonumber(len)
      local res = len > 0 and client:receive(len) or "Invalid stack information."
      print("Error in expression: " .. res)
      return nil, nil, res
    else
      print("Unknown error")
      return nil, nil, "Debugger error: unexpected response after STACK"
    end
  elseif command == "output" then
    local _, _, stream, mode = string.find(params, "^[a-z]+%s+(%w+)%s+([dcr])%s*$")
    if stream and mode then
      client:send("OUTPUT "..stream.." "..mode.."\\n")
      local resp, err = client:receive("*l")
      if not resp then
        print("Unknown error: "..err)
        return nil, nil, "Debugger connection error: "..err
      end
      local _, _, status = string.find(resp, "^(%d+)%s+%w+%s*$")
      if status == "200" then
        print("Stream "..stream.." redirected")
        outputs[stream] = type(options) == 'table' and options.handler or nil
      -- the client knows when she is doing, so install the handler
      elseif type(options) == 'table' and options.handler then
        outputs[stream] = options.handler
      else
        print("Unknown error")
        return nil, nil, "Debugger error: can't redirect "..stream
      end
    else
      print("Invalid command")
    end
  elseif command == "basedir" then
    local _, _, dir = string.find(params, "^[a-z]+%s+(.+)$")
    if dir then
      dir = string.gsub(dir, "\\\\", "/") -- convert slash
      if not string.find(dir, "/$") then dir = dir .. "/" end

      local remdir = dir:match("\\t(.+)")
      if remdir then dir = dir:gsub("/?\\t.+", "/") end
      basedir = dir

      client:send("BASEDIR "..(remdir or dir).."\\n")
      local resp, err = client:receive("*l")
      if not resp then
        print("Unknown error: "..err)
        return nil, nil, "Debugger connection error: "..err
      end
      local _, _, status = string.find(resp, "^(%d+)%s+%w+%s*$")
      if status == "200" then
        print("New base directory is " .. basedir)
      else
        print("Unknown error")
        return nil, nil, "Debugger error: unexpected response after BASEDIR"
      end
    else
      print(basedir)
    end
  elseif command == "help" then
    print("setb <file> <line>    -- sets a breakpoint")
    print("delb <file> <line>    -- removes a breakpoint")
    print("delallb               -- removes all breakpoints")
    print("setw <exp>            -- adds a new watch expression")
    print("delw <index>          -- removes the watch expression at index")
    print("delallw               -- removes all watch expressions")
    print("run                   -- runs until next breakpoint")
    print("step                  -- runs until next line, stepping into function calls")
    print("over                  -- runs until next line, stepping over function calls")
    print("out                   -- runs until line after returning from current function")
    print("listb                 -- lists breakpoints")
    print("listw                 -- lists watch expressions")
    print("eval <exp>            -- evaluates expression on the current context and returns its value")
    print("exec <stmt>           -- executes statement on the current context")
    print("load <file>           -- loads a local file for debugging")
    print("reload                -- restarts the current debugging session")
    print("stack                 -- reports stack trace")
    print("output stdout <d|c|r> -- capture and redirect io stream (default|copy|redirect)")
    print("basedir [<path>]      -- sets the base path of the remote application, or shows the current one")
    print("done                  -- stops the debugger and continues application execution")
    print("exit                  -- exits debugger and the application")
  else
    local _, _, spaces = string.find(params, "^(%s*)$")
    if spaces then
      return nil, nil, "Empty command"
    else
      print("Invalid command")
      return nil, nil, "Invalid command"
    end
  end
  return file, line
end

-- Starts debugging server
local function listen(host, port)
  host = host or "*"
  port = port or mobdebug.port

  local socket = require "socket"

  print("Lua Remote Debugger")
  print("Run the program you wish to debug")

  local server = socket.bind(host, port)
  local client = server:accept()

  client:send("STEP\\n")
  client:receive("*l")

  local breakpoint = client:receive("*l")
  local _, _, file, line = string.find(breakpoint, "^202 Paused%s+(.-)%s+(%d+)%s*$")
  if file and line then
    print("Paused at file " .. file )
    print("Type 'help' for commands")
  else
    local _, _, size = string.find(breakpoint, "^401 Error in Execution (%d+)%s*$")
    if size then
      print("Error in remote application: ")
      print(client:receive(size))
    end
  end

  while true do
    io.write("> ")
    local file, _, err = handle(io.read("*line"), client)
    if not file and err == false then break end -- completed debugging
  end

  client:close()
end

local cocreate
local function coro()
  if cocreate then return end -- only set once
  cocreate = cocreate or coroutine.create
  coroutine.create = function(f, ...)
    return cocreate(function(...)
      mobdebug.on()
      return f(...)
    end, ...)
  end
end

local moconew
local function moai()
  if moconew then return end -- only set once
  moconew = moconew or (MOAICoroutine and MOAICoroutine.new)
  if not moconew then return end
  MOAICoroutine.new = function(...)
    local thread = moconew(...)
    -- need to support both thread.run and getmetatable(thread).run, which
    -- was used in earlier MOAI versions
    local mt = thread.run and thread or getmetatable(thread)
    local patched = mt.run
    mt.run = function(self, f, ...)
      return patched(self,  function(...)
        mobdebug.on()
        return f(...)
      end, ...)
    end
    return thread
  end
end

-- make public functions available
mobdebug.setbreakpoint = set_breakpoint
mobdebug.removebreakpoint = remove_breakpoint
mobdebug.listen = listen
mobdebug.loop = loop
mobdebug.scratchpad = scratchpad
mobdebug.handle = handle
mobdebug.connect = connect
mobdebug.start = start
mobdebug.on = on
mobdebug.off = off
mobdebug.moai = moai
mobdebug.coro = coro
mobdebug.done = done
mobdebug.pause = function() step_into = true end
mobdebug.yield = nil -- callback
mobdebug.output = output
mobdebug.onexit = os and os.exit or done
mobdebug.onscratch = nil -- callback
mobdebug.basedir = function(b) if b then basedir = b end return basedir end

return mobdebug
`;var Rn=`-- Host adaptation for the unmodified, pinned MobDebug engine.
-- User source is loaded as a named chunk without rewriting its text.
local source, filename = __wasm_idle_debug_source, __wasm_idle_debug_file
local emit, read = __wasm_idle_debug_event, __wasm_idle_debug_read
local pause_at_entry = __wasm_idle_debug_entry
local initial_breakpoints = __wasm_idle_debug_breakpoints
local mobdebug_source = __wasm_idle_mobdebug_source
local original_tostring = tostring
local function safe_tostring(value)
  local kind = type(value)
  if kind == 'table' or kind == 'userdata' then return '<' .. kind .. '>' end
  return original_tostring(value)
end
local function quote(value)
  return '"' .. value:gsub('[%z\\1-\\31\\\\"]', function(char)
    if char == '"' then return '\\\\"' end
    if char == '\\\\' then return '\\\\\\\\' end
    return string.format('\\\\u%04x', string.byte(char))
  end) .. '"'
end
local function bounded(value, limit)
  value = safe_tostring(value)
  return #value > limit and value:sub(1, limit) .. '\u2026' or value
end
local queue, received = {'LOAD 0 -\\n'}, ''
local nonblocking, closed = false, false
local current_file, current_line, current_reason = filename, 1, 'entry'
local next_reason, stack_requested, eval_id = 'step', false, nil
local breakpoints = {}
for line in initial_breakpoints:gmatch('%d+') do breakpoints[tonumber(line)] = true end
local pending_error, error_size
local peer = {}
function peer:settimeout(timeout) nonblocking = timeout == 0 end
function peer:close() closed = true end
function peer:connect() return true end
function peer:receive(pattern)
  while true do
    local ending = pattern == '*l' and received:find('\\n', 1, true)
      or type(pattern) == 'number' and #received >= pattern and pattern
    if ending then
      local value = received:sub(1, pattern == '*l' and ending - 1 or ending)
      received = received:sub(ending + 1)
      if pattern == '*l' then
        stack_requested = value:match('^STACK') ~= nil
        local command, file, line = value:match('^(%u+)%s+(.-)%s+(%d+)%s*$')
        if command == 'DELB' and file == '*' and line == '0' then breakpoints = {} end
        if command == 'SETB' and file == filename then breakpoints[tonumber(line)] = true end
        if command == 'DELB' and file == filename then breakpoints[tonumber(line)] = nil end
        if value == 'STEP' then next_reason = 'step'
        elseif value == 'OVER' then next_reason = 'nextLine'
        elseif value == 'OUT' then next_reason = 'stepOut' end
        if value:match('^EXEC ') then
          local parameters = value:match('%-%-(%b{})%s*$')
          eval_id = parameters and tonumber(parameters:match('requestId=(%d+)')) or nil
        end
      end
      return value
    end
    if closed then return nil, 'closed' end
    local chunk
    if #queue > 0 then chunk = table.remove(queue, 1) else chunk = read(not nonblocking) end
    if chunk == nil then closed = true; return nil, 'closed' end
    if chunk == '' then return nil, 'timeout' end
    received = received .. chunk
  end
end
local function request_stack()
  queue[#queue + 1] = 'STACK --{maxlevel=4,maxnum=50,metatostring=false}\\n'
end
function peer:send(message)
  if pending_error then
    pending_error = pending_error .. message
    if #pending_error >= error_size then
      if eval_id then
        emit('{"type":"evaluate","id":' .. eval_id .. ',"error":' .. quote(bounded(pending_error, 4096)) .. '}')
        eval_id = nil
      end
      pending_error = nil
    end
    return #message
  end
  local started_file, started_line = message:match('^201 Started%s+(.-)%s+(%d+)\\n$')
  local paused_file, paused_line = message:match('^202 Paused%s+(.-)%s+(%d+)\\n$')
  if started_file or paused_file then
    current_file, current_line = started_file or paused_file, tonumber(started_line or paused_line)
    current_reason = started_file and 'entry' or breakpoints[current_line] and 'breakpoint' or next_reason
    if started_file and not pause_at_entry and not breakpoints[current_line] then
      queue[#queue + 1] = 'RUN\\n'
    else
      request_stack()
    end
  elseif message:match('^401 ') then
    error_size = tonumber(message:match('(%d+)\\n$')) or 0
    pending_error = ''
  end
  return #message
end
local saved_socket = package.loaded.socket
package.loaded.socket = {tcp = function() return peer end}
local environment = setmetatable({tostring = safe_tostring}, {__index = _G})
local mobdebug = assert(load(mobdebug_source, '@__wasm_idle_mobdebug.lua', 't', environment))()
package.loaded.socket = saved_socket
mobdebug.connect = function() return peer end
mobdebug.onexit = function() error('Lua debugger stopped', 0) end
local original_dump = mobdebug.dump
local function preview(value)
  local ok, text = pcall(mobdebug.line, value, {
    nocode = true, comment = false, metatostring = false,
    maxlevel = 2, maxnum = 25, maxlength = 512
  })
  return ok and bounded(text, 1024) or '<unavailable>'
end
local preview_budget = 0
local function variables(values, existing)
  local entries, names = {}, {}
  for name in next, values or {} do
    if type(name) == 'string' and name ~= '_ENV' and not name:match('^%(') then
      names[#names + 1] = name
    end
  end
  table.sort(names)
  for _, name in ipairs(names) do
    if #entries >= 100 then break end
    if not existing[name] then
      existing[name] = true
      if preview_budget <= 0 then break end
      local value = rawget(rawget(values, name), 1)
      local entry = '{"name":' .. quote(bounded(name, 256))
        .. ',"type":' .. quote(type(value)) .. ',"value":' .. quote(preview(value)) .. '}'
      if #entry > preview_budget then break end
      entries[#entries + 1] = entry
      preview_budget = preview_budget - #entry
    end
  end
  return entries
end
mobdebug.dump = function(value, parameters)
  if stack_requested then
    stack_requested = false
    preview_budget = 131072
    local frames = {}
    for _, frame in ipairs(value) do
      local info = frame[1]
      local file, line = info[2], info[4]
      if file == filename and line > 0 then
        local names = {}
        local entries = variables(frame[2], names)
        for _, item in ipairs(variables(frame[3], names)) do entries[#entries + 1] = item end
        frames[#frames + 1] = '{"functionName":' .. quote(bounded(info[1] or '<main>', 256))
          .. ',"sourcePath":' .. quote(file) .. ',"line":' .. line
          .. ',"locals":[' .. table.concat(entries, ',') .. ']}'
        if #frames >= 64 then break end
      end
    end
    emit('{"type":"pause","sourcePath":' .. quote(current_file) .. ',"line":' .. current_line
      .. ',"reason":' .. quote(current_reason) .. ',"frames":[' .. table.concat(frames, ',') .. ']}')
    return 'nil'
  elseif eval_id then
    emit('{"type":"evaluate","id":' .. eval_id .. ',"value":' .. quote(bounded(value[1] or 'nil', 4096)) .. '}')
    eval_id = nil
    return ''
  end
  return original_dump(value, parameters)
end
for line in pairs(breakpoints) do mobdebug.setbreakpoint(filename, line) end
mobdebug.coro()
local program = assert(load(source, '@' .. filename))
local ok, result = pcall(function() mobdebug.start(); program(); mobdebug.done() end)
mobdebug.done()
if not ok then error(result, 0) end
`;async function Pn(f,_,x,C){if(!x||/[\r\n\0]/u.test(x))throw new Error("Lua debugging requires a source filename without control characters.");f.global.set("__wasm_idle_mobdebug_source",Fn),f.global.set("__wasm_idle_debug_source",_),f.global.set("__wasm_idle_debug_file",x),f.global.set("__wasm_idle_debug_entry",C.pauseOnEntry!==!1),f.global.set("__wasm_idle_debug_breakpoints",(C.breakpoints??[]).filter(U=>Number.isSafeInteger(U)&&U>0).slice(0,1024).join(",")),f.global.set("__wasm_idle_debug_read",C.readCommand),f.global.set("__wasm_idle_debug_event",U=>{C.onEvent(JSON.parse(U))}),await f.doString(Rn)}var Dn=new Map;function $r(){return/\/src\/index\.ts(?:$|\?)/u.test(import.meta.url)?new URL("../dist/glue.wasm",import.meta.url).href:new URL("./glue.wasm",import.meta.url).href}function jr(f){return f&&f.trim()?f.trim():$r()}function Rt(f){let _=jr(f),x=Dn.get(_);return x||(x=new Nn.LuaFactory(_),Dn.set(_,x)),x}function Hr(f,_){let x=f instanceof Error?f.message:String(f),C=x.replace(/^Error:\s*/u,"").trim(),U=/^([^:\n]+):(\d+):\s*([\s\S]*)$/u.exec(C);return{fileName:U?.[1]||_,lineNumber:Number(U?.[2]||1),severity:"error",message:(U?.[3]||C||x).trim()}}function In(f){return`"${f.replace(/\\/gu,"\\\\").replace(/"/gu,'\\"').replace(/\n/gu,"\\n").replace(/\r/gu,"\\r").replace(/\t/gu,"\\t")}"`}function qr(f,_){let x=[`[0] = ${In(f)}`];for(let[C,U]of _.entries())x.push(`[${C+1}] = ${In(U)}`);return`arg = { ${x.join(", ")} }`}function Wr(f){let _="",x=!1,C=()=>{if(x||!f)return!1;let U=f();return U==null?(x=!0,!1):(_+=String(U),!0)};return(U="*l")=>{let j=String(U||"*l");if(j==="*a"||j==="a"){for(;C(););let ne=_;return _="",ne}let ae=typeof U=="number"?Math.max(0,Math.trunc(U)):/^\d+$/u.test(j)?Number(j):null;if(ae!==null){for(;_.length<ae&&C(););if(!_&&x)return null;let ne=_.slice(0,ae);return _=_.slice(ae),ne}for(;!_.includes(`
`)&&C(););if(!_&&x)return null;let H=_.indexOf(`
`);if(H===-1){let ne=_.replace(/\r$/u,"");return _="",ne||null}let K=_.slice(0,H).replace(/\r$/u,"");return _=_.slice(H+1),K}}function Yr(f){return f==null?"nil":String(f)}async function Gr(f){let _=f.fileName||"main.lua",C=await Rt(f.wasmUrl).createEngine();try{return C.global.set("__wasm_idle_source",f.code),C.global.set("__wasm_idle_chunk_name",`@${_}`),await C.doString(`
local chunk, err = load(__wasm_idle_source, __wasm_idle_chunk_name)
if not chunk then
  error(err, 0)
end
`),{success:!0,artifact:{source:f.code,fileName:_},diagnostics:[],stdout:"",stderr:""}}catch(U){let j=Hr(U,_);return{success:!1,diagnostics:[j],stdout:"",stderr:j.message}}finally{C.global.close()}}async function Kr(f={}){let _=typeof f=="string"?f:f.wasmUrl;return Rt(_),{compile:x=>Gr({...x,wasmUrl:x.wasmUrl||_})}}async function ra(f,_={}){let x=[],C=[],U=K=>{x.push(K),_.stdout?.(K)},j=K=>{C.push(K),_.stderr?.(K)},H=await Rt(_.wasmUrl).createEngine();try{return H.global.set("print",(...K)=>{U(`${K.map(Yr).join("	")}
`)}),H.global.set("__wasm_idle_read_stdin",Wr(_.stdin)),await H.doString(qr(f.fileName,_.args||[])),await H.doString(`
if io then
  io.read = function(mode)
    if mode == nil then
      mode = "*l"
    end
    return __wasm_idle_read_stdin(mode)
  end
end
`),_.onReady?.(),_.debug?await Pn(H,f.source,f.fileName,_.debug):await H.doString(f.source),{exitCode:0,stdout:x.join(""),stderr:C.join("")}}catch(K){let ne=K instanceof Error?K.message:String(K);return j(`${ne}
`),{exitCode:1,stdout:x.join(""),stderr:C.join("")}}finally{H.global.close()}}var aa=Kr;export{Gr as compileLua,Kr as createLuaCompiler,aa as default,ra as executeBrowserLuaArtifact};
