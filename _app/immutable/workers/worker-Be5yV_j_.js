var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n)),l=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.stringArray=e.array=e.func=e.error=e.number=e.string=e.boolean=void 0;function t(e){return e===!0||e===!1}e.boolean=t;function n(e){return typeof e==`string`||e instanceof String}e.string=n;function r(e){return typeof e==`number`||e instanceof Number}e.number=r;function i(e){return e instanceof Error}e.error=i;function a(e){return typeof e==`function`}e.func=a;function o(e){return Array.isArray(e)}e.array=o;function s(e){return o(e)&&e.every(e=>n(e))}e.stringArray=s})),u=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Message=e.NotificationType9=e.NotificationType8=e.NotificationType7=e.NotificationType6=e.NotificationType5=e.NotificationType4=e.NotificationType3=e.NotificationType2=e.NotificationType1=e.NotificationType0=e.NotificationType=e.RequestType9=e.RequestType8=e.RequestType7=e.RequestType6=e.RequestType5=e.RequestType4=e.RequestType3=e.RequestType2=e.RequestType1=e.RequestType=e.RequestType0=e.AbstractMessageSignature=e.ParameterStructures=e.ResponseError=e.ErrorCodes=void 0;let t=l();var n;(function(e){e.ParseError=-32700,e.InvalidRequest=-32600,e.MethodNotFound=-32601,e.InvalidParams=-32602,e.InternalError=-32603,e.jsonrpcReservedErrorRangeStart=-32099,e.serverErrorStart=-32099,e.MessageWriteError=-32099,e.MessageReadError=-32098,e.PendingResponseRejected=-32097,e.ConnectionInactive=-32096,e.ServerNotInitialized=-32002,e.UnknownErrorCode=-32001,e.jsonrpcReservedErrorRangeEnd=-32e3,e.serverErrorEnd=-32e3})(n||(e.ErrorCodes=n={})),e.ResponseError=class e extends Error{constructor(r,i,a){super(i),this.code=t.number(r)?r:n.UnknownErrorCode,this.data=a,Object.setPrototypeOf(this,e.prototype)}toJson(){let e={code:this.code,message:this.message};return this.data!==void 0&&(e.data=this.data),e}};var r=class e{constructor(e){this.kind=e}static is(t){return t===e.auto||t===e.byName||t===e.byPosition}toString(){return this.kind}};e.ParameterStructures=r,r.auto=new r(`auto`),r.byPosition=new r(`byPosition`),r.byName=new r(`byName`);var i=class{constructor(e,t){this.method=e,this.numberOfParams=t}get parameterStructures(){return r.auto}};e.AbstractMessageSignature=i,e.RequestType0=class extends i{constructor(e){super(e,0)}},e.RequestType=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.RequestType1=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.RequestType2=class extends i{constructor(e){super(e,2)}},e.RequestType3=class extends i{constructor(e){super(e,3)}},e.RequestType4=class extends i{constructor(e){super(e,4)}},e.RequestType5=class extends i{constructor(e){super(e,5)}},e.RequestType6=class extends i{constructor(e){super(e,6)}},e.RequestType7=class extends i{constructor(e){super(e,7)}},e.RequestType8=class extends i{constructor(e){super(e,8)}},e.RequestType9=class extends i{constructor(e){super(e,9)}},e.NotificationType=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.NotificationType0=class extends i{constructor(e){super(e,0)}},e.NotificationType1=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.NotificationType2=class extends i{constructor(e){super(e,2)}},e.NotificationType3=class extends i{constructor(e){super(e,3)}},e.NotificationType4=class extends i{constructor(e){super(e,4)}},e.NotificationType5=class extends i{constructor(e){super(e,5)}},e.NotificationType6=class extends i{constructor(e){super(e,6)}},e.NotificationType7=class extends i{constructor(e){super(e,7)}},e.NotificationType8=class extends i{constructor(e){super(e,8)}},e.NotificationType9=class extends i{constructor(e){super(e,9)}};var a;(function(e){function n(e){let n=e;return n&&t.string(n.method)&&(t.string(n.id)||t.number(n.id))}e.isRequest=n;function r(e){let n=e;return n&&t.string(n.method)&&e.id===void 0}e.isNotification=r;function i(e){let n=e;return n&&(n.result!==void 0||!!n.error)&&(t.string(n.id)||t.number(n.id)||n.id===null)}e.isResponse=i})(a||(e.Message=a={}))})),d=o((e=>{var t;Object.defineProperty(e,`__esModule`,{value:!0}),e.LRUCache=e.LinkedMap=e.Touch=void 0;var n;(function(e){e.None=0,e.First=1,e.AsOld=e.First,e.Last=2,e.AsNew=e.Last})(n||(e.Touch=n={}));var r=class{constructor(){this[t]=`LinkedMap`,this._map=new Map,this._head=void 0,this._tail=void 0,this._size=0,this._state=0}clear(){this._map.clear(),this._head=void 0,this._tail=void 0,this._size=0,this._state++}isEmpty(){return!this._head&&!this._tail}get size(){return this._size}get first(){return this._head?.value}get last(){return this._tail?.value}has(e){return this._map.has(e)}get(e,t=n.None){let r=this._map.get(e);if(r)return t!==n.None&&this.touch(r,t),r.value}set(e,t,r=n.None){let i=this._map.get(e);if(i)i.value=t,r!==n.None&&this.touch(i,r);else{switch(i={key:e,value:t,next:void 0,previous:void 0},r){case n.None:this.addItemLast(i);break;case n.First:this.addItemFirst(i);break;case n.Last:this.addItemLast(i);break;default:this.addItemLast(i);break}this._map.set(e,i),this._size++}return this}delete(e){return!!this.remove(e)}remove(e){let t=this._map.get(e);if(t)return this._map.delete(e),this.removeItem(t),this._size--,t.value}shift(){if(!this._head&&!this._tail)return;if(!this._head||!this._tail)throw Error(`Invalid list`);let e=this._head;return this._map.delete(e.key),this.removeItem(e),this._size--,e.value}forEach(e,t){let n=this._state,r=this._head;for(;r;){if(t?e.bind(t)(r.value,r.key,this):e(r.value,r.key,this),this._state!==n)throw Error(`LinkedMap got modified during iteration.`);r=r.next}}keys(){let e=this._state,t=this._head,n={[Symbol.iterator]:()=>n,next:()=>{if(this._state!==e)throw Error(`LinkedMap got modified during iteration.`);if(t){let e={value:t.key,done:!1};return t=t.next,e}else return{value:void 0,done:!0}}};return n}values(){let e=this._state,t=this._head,n={[Symbol.iterator]:()=>n,next:()=>{if(this._state!==e)throw Error(`LinkedMap got modified during iteration.`);if(t){let e={value:t.value,done:!1};return t=t.next,e}else return{value:void 0,done:!0}}};return n}entries(){let e=this._state,t=this._head,n={[Symbol.iterator]:()=>n,next:()=>{if(this._state!==e)throw Error(`LinkedMap got modified during iteration.`);if(t){let e={value:[t.key,t.value],done:!1};return t=t.next,e}else return{value:void 0,done:!0}}};return n}[(t=Symbol.toStringTag,Symbol.iterator)](){return this.entries()}trimOld(e){if(e>=this.size)return;if(e===0){this.clear();return}let t=this._head,n=this.size;for(;t&&n>e;)this._map.delete(t.key),t=t.next,n--;this._head=t,this._size=n,t&&(t.previous=void 0),this._state++}addItemFirst(e){if(!this._head&&!this._tail)this._tail=e;else if(this._head)e.next=this._head,this._head.previous=e;else throw Error(`Invalid list`);this._head=e,this._state++}addItemLast(e){if(!this._head&&!this._tail)this._head=e;else if(this._tail)e.previous=this._tail,this._tail.next=e;else throw Error(`Invalid list`);this._tail=e,this._state++}removeItem(e){if(e===this._head&&e===this._tail)this._head=void 0,this._tail=void 0;else if(e===this._head){if(!e.next)throw Error(`Invalid list`);e.next.previous=void 0,this._head=e.next}else if(e===this._tail){if(!e.previous)throw Error(`Invalid list`);e.previous.next=void 0,this._tail=e.previous}else{let t=e.next,n=e.previous;if(!t||!n)throw Error(`Invalid list`);t.previous=n,n.next=t}e.next=void 0,e.previous=void 0,this._state++}touch(e,t){if(!this._head||!this._tail)throw Error(`Invalid list`);if(!(t!==n.First&&t!==n.Last)){if(t===n.First){if(e===this._head)return;let t=e.next,n=e.previous;e===this._tail?(n.next=void 0,this._tail=n):(t.previous=n,n.next=t),e.previous=void 0,e.next=this._head,this._head.previous=e,this._head=e,this._state++}else if(t===n.Last){if(e===this._tail)return;let t=e.next,n=e.previous;e===this._head?(t.previous=void 0,this._head=t):(t.previous=n,n.next=t),e.next=void 0,e.previous=this._tail,this._tail.next=e,this._tail=e,this._state++}}}toJSON(){let e=[];return this.forEach((t,n)=>{e.push([n,t])}),e}fromJSON(e){this.clear();for(let[t,n]of e)this.set(t,n)}};e.LinkedMap=r,e.LRUCache=class extends r{constructor(e,t=1){super(),this._limit=e,this._ratio=Math.min(Math.max(0,t),1)}get limit(){return this._limit}set limit(e){this._limit=e,this.checkTrim()}get ratio(){return this._ratio}set ratio(e){this._ratio=Math.min(Math.max(0,e),1),this.checkTrim()}get(e,t=n.AsNew){return super.get(e,t)}peek(e){return super.get(e,n.None)}set(e,t){return super.set(e,t,n.Last),this.checkTrim(),this}checkTrim(){this.size>this._limit&&this.trimOld(Math.round(this._limit*this._ratio))}}})),f=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Disposable=void 0;var t;(function(e){function t(e){return{dispose:e}}e.create=t})(t||(e.Disposable=t={}))})),p=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0});let t;function n(){if(t===void 0)throw Error(`No runtime abstraction layer installed`);return t}(function(e){function n(e){if(e===void 0)throw Error(`No runtime abstraction layer provided`);t=e}e.install=n})(n||={}),e.default=n})),m=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Emitter=e.Event=void 0;let t=p();var n;(function(e){let t={dispose(){}};e.None=function(){return t}})(n||(e.Event=n={}));var r=class{add(e,t=null,n){this._callbacks||(this._callbacks=[],this._contexts=[]),this._callbacks.push(e),this._contexts.push(t),Array.isArray(n)&&n.push({dispose:()=>this.remove(e,t)})}remove(e,t=null){if(!this._callbacks)return;let n=!1;for(let r=0,i=this._callbacks.length;r<i;r++)if(this._callbacks[r]===e)if(this._contexts[r]===t){this._callbacks.splice(r,1),this._contexts.splice(r,1);return}else n=!0;if(n)throw Error(`When adding a listener with a context, you should remove it with the same context`)}invoke(...e){if(!this._callbacks)return[];let n=[],r=this._callbacks.slice(0),i=this._contexts.slice(0);for(let a=0,o=r.length;a<o;a++)try{n.push(r[a].apply(i[a],e))}catch(e){(0,t.default)().console.error(e)}return n}isEmpty(){return!this._callbacks||this._callbacks.length===0}dispose(){this._callbacks=void 0,this._contexts=void 0}},i=class e{constructor(e){this._options=e}get event(){return this._event||=(t,n,i)=>{this._callbacks||=new r,this._options&&this._options.onFirstListenerAdd&&this._callbacks.isEmpty()&&this._options.onFirstListenerAdd(this),this._callbacks.add(t,n);let a={dispose:()=>{this._callbacks&&(this._callbacks.remove(t,n),a.dispose=e._noop,this._options&&this._options.onLastListenerRemove&&this._callbacks.isEmpty()&&this._options.onLastListenerRemove(this))}};return Array.isArray(i)&&i.push(a),a},this._event}fire(e){this._callbacks&&this._callbacks.invoke.call(this._callbacks,e)}dispose(){this._callbacks&&=(this._callbacks.dispose(),void 0)}};e.Emitter=i,i._noop=function(){}})),ee=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.CancellationTokenSource=e.CancellationToken=void 0;let t=p(),n=l(),r=m();var i;(function(e){e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:r.Event.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:r.Event.None});function t(t){let r=t;return r&&(r===e.None||r===e.Cancelled||n.boolean(r.isCancellationRequested)&&!!r.onCancellationRequested)}e.is=t})(i||(e.CancellationToken=i={}));let a=Object.freeze(function(e,n){let r=(0,t.default)().timer.setTimeout(e.bind(n),0);return{dispose(){r.dispose()}}});var o=class{constructor(){this._isCancelled=!1}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?a:(this._emitter||=new r.Emitter,this._emitter.event)}dispose(){this._emitter&&=(this._emitter.dispose(),void 0)}};e.CancellationTokenSource=class{get token(){return this._token||=new o,this._token}cancel(){this._token?this._token.cancel():this._token=i.Cancelled}dispose(){this._token?this._token instanceof o&&this._token.dispose():this._token=i.None}}})),te=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.SharedArrayReceiverStrategy=e.SharedArraySenderStrategy=void 0;let t=ee();var n;(function(e){e.Continue=0,e.Cancelled=1})(n||={}),e.SharedArraySenderStrategy=class{constructor(){this.buffers=new Map}enableCancellation(e){if(e.id===null)return;let t=new SharedArrayBuffer(4),r=new Int32Array(t,0,1);r[0]=n.Continue,this.buffers.set(e.id,t),e.$cancellationData=t}async sendCancellation(e,t){let r=this.buffers.get(t);if(r===void 0)return;let i=new Int32Array(r,0,1);Atomics.store(i,0,n.Cancelled)}cleanup(e){this.buffers.delete(e)}dispose(){this.buffers.clear()}};var r=class{constructor(e){this.data=new Int32Array(e,0,1)}get isCancellationRequested(){return Atomics.load(this.data,0)===n.Cancelled}get onCancellationRequested(){throw Error(`Cancellation over SharedArrayBuffer doesn't support cancellation events`)}},i=class{constructor(e){this.token=new r(e)}cancel(){}dispose(){}};e.SharedArrayReceiverStrategy=class{constructor(){this.kind=`request`}createCancellationTokenSource(e){let n=e.$cancellationData;return n===void 0?new t.CancellationTokenSource:new i(n)}}})),h=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Semaphore=void 0;let t=p();e.Semaphore=class{constructor(e=1){if(e<=0)throw Error(`Capacity must be greater than 0`);this._capacity=e,this._active=0,this._waiting=[]}lock(e){return new Promise((t,n)=>{this._waiting.push({thunk:e,resolve:t,reject:n}),this.runNext()})}get active(){return this._active}runNext(){this._waiting.length===0||this._active===this._capacity||(0,t.default)().timer.setImmediate(()=>this.doRunNext())}doRunNext(){if(this._waiting.length===0||this._active===this._capacity)return;let e=this._waiting.shift();if(this._active++,this._active>this._capacity)throw Error(`To many thunks active`);try{let t=e.thunk();t instanceof Promise?t.then(t=>{this._active--,e.resolve(t),this.runNext()},t=>{this._active--,e.reject(t),this.runNext()}):(this._active--,e.resolve(t),this.runNext())}catch(t){this._active--,e.reject(t),this.runNext()}}}})),ne=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.ReadableStreamMessageReader=e.AbstractMessageReader=e.MessageReader=void 0;let t=p(),n=l(),r=m(),i=h();var a;(function(e){function t(e){let t=e;return t&&n.func(t.listen)&&n.func(t.dispose)&&n.func(t.onError)&&n.func(t.onClose)&&n.func(t.onPartialMessage)}e.is=t})(a||(e.MessageReader=a={}));var o=class{constructor(){this.errorEmitter=new r.Emitter,this.closeEmitter=new r.Emitter,this.partialMessageEmitter=new r.Emitter}dispose(){this.errorEmitter.dispose(),this.closeEmitter.dispose()}get onError(){return this.errorEmitter.event}fireError(e){this.errorEmitter.fire(this.asError(e))}get onClose(){return this.closeEmitter.event}fireClose(){this.closeEmitter.fire(void 0)}get onPartialMessage(){return this.partialMessageEmitter.event}firePartialMessage(e){this.partialMessageEmitter.fire(e)}asError(e){return e instanceof Error?e:Error(`Reader received error. Reason: ${n.string(e.message)?e.message:`unknown`}`)}};e.AbstractMessageReader=o;var s;(function(e){function n(e){let n,r,i=new Map,a,o=new Map;if(e===void 0||typeof e==`string`)n=e??`utf-8`;else{if(n=e.charset??`utf-8`,e.contentDecoder!==void 0&&(r=e.contentDecoder,i.set(r.name,r)),e.contentDecoders!==void 0)for(let t of e.contentDecoders)i.set(t.name,t);if(e.contentTypeDecoder!==void 0&&(a=e.contentTypeDecoder,o.set(a.name,a)),e.contentTypeDecoders!==void 0)for(let t of e.contentTypeDecoders)o.set(t.name,t)}return a===void 0&&(a=(0,t.default)().applicationJson.decoder,o.set(a.name,a)),{charset:n,contentDecoder:r,contentDecoders:i,contentTypeDecoder:a,contentTypeDecoders:o}}e.fromOptions=n})(s||={}),e.ReadableStreamMessageReader=class extends o{constructor(e,n){super(),this.readable=e,this.options=s.fromOptions(n),this.buffer=(0,t.default)().messageBuffer.create(this.options.charset),this._partialMessageTimeout=1e4,this.nextMessageLength=-1,this.messageToken=0,this.readSemaphore=new i.Semaphore(1)}set partialMessageTimeout(e){this._partialMessageTimeout=e}get partialMessageTimeout(){return this._partialMessageTimeout}listen(e){this.nextMessageLength=-1,this.messageToken=0,this.partialMessageTimer=void 0,this.callback=e;let t=this.readable.onData(e=>{this.onData(e)});return this.readable.onError(e=>this.fireError(e)),this.readable.onClose(()=>this.fireClose()),t}onData(e){try{for(this.buffer.append(e);;){if(this.nextMessageLength===-1){let e=this.buffer.tryReadHeaders(!0);if(!e)return;let t=e.get(`content-length`);if(!t){this.fireError(Error(`Header must provide a Content-Length property.\n${JSON.stringify(Object.fromEntries(e))}`));return}let n=parseInt(t);if(isNaN(n)){this.fireError(Error(`Content-Length value must be a number. Got ${t}`));return}this.nextMessageLength=n}let e=this.buffer.tryReadBody(this.nextMessageLength);if(e===void 0){this.setPartialMessageTimer();return}this.clearPartialMessageTimer(),this.nextMessageLength=-1,this.readSemaphore.lock(async()=>{let t=this.options.contentDecoder===void 0?e:await this.options.contentDecoder.decode(e),n=await this.options.contentTypeDecoder.decode(t,this.options);this.callback(n)}).catch(e=>{this.fireError(e)})}}catch(e){this.fireError(e)}}clearPartialMessageTimer(){this.partialMessageTimer&&=(this.partialMessageTimer.dispose(),void 0)}setPartialMessageTimer(){this.clearPartialMessageTimer(),!(this._partialMessageTimeout<=0)&&(this.partialMessageTimer=(0,t.default)().timer.setTimeout((e,t)=>{this.partialMessageTimer=void 0,e===this.messageToken&&(this.firePartialMessage({messageToken:e,waitingTime:t}),this.setPartialMessageTimer())},this._partialMessageTimeout,this.messageToken,this._partialMessageTimeout))}}})),g=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.WriteableStreamMessageWriter=e.AbstractMessageWriter=e.MessageWriter=void 0;let t=p(),n=l(),r=h(),i=m();var a;(function(e){function t(e){let t=e;return t&&n.func(t.dispose)&&n.func(t.onClose)&&n.func(t.onError)&&n.func(t.write)}e.is=t})(a||(e.MessageWriter=a={}));var o=class{constructor(){this.errorEmitter=new i.Emitter,this.closeEmitter=new i.Emitter}dispose(){this.errorEmitter.dispose(),this.closeEmitter.dispose()}get onError(){return this.errorEmitter.event}fireError(e,t,n){this.errorEmitter.fire([this.asError(e),t,n])}get onClose(){return this.closeEmitter.event}fireClose(){this.closeEmitter.fire(void 0)}asError(e){return e instanceof Error?e:Error(`Writer received error. Reason: ${n.string(e.message)?e.message:`unknown`}`)}};e.AbstractMessageWriter=o;var s;(function(e){function n(e){return e===void 0||typeof e==`string`?{charset:e??`utf-8`,contentTypeEncoder:(0,t.default)().applicationJson.encoder}:{charset:e.charset??`utf-8`,contentEncoder:e.contentEncoder,contentTypeEncoder:e.contentTypeEncoder??(0,t.default)().applicationJson.encoder}}e.fromOptions=n})(s||={}),e.WriteableStreamMessageWriter=class extends o{constructor(e,t){super(),this.writable=e,this.options=s.fromOptions(t),this.errorCount=0,this.writeSemaphore=new r.Semaphore(1),this.writable.onError(e=>this.fireError(e)),this.writable.onClose(()=>this.fireClose())}async write(e){return this.writeSemaphore.lock(async()=>this.options.contentTypeEncoder.encode(e,this.options).then(e=>this.options.contentEncoder===void 0?e:this.options.contentEncoder.encode(e)).then(t=>{let n=[];return n.push(`Content-Length: `,t.byteLength.toString(),`\r
`),n.push(`\r
`),this.doWrite(e,n,t)},e=>{throw this.fireError(e),e}))}async doWrite(e,t,n){try{return await this.writable.write(t.join(``),`ascii`),this.writable.write(n)}catch(t){return this.handleError(t,e),Promise.reject(t)}}handleError(e,t){this.errorCount++,this.fireError(e,t,this.errorCount)}end(){this.writable.end()}}})),re=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.AbstractMessageBuffer=void 0,e.AbstractMessageBuffer=class{constructor(e=`utf-8`){this._encoding=e,this._chunks=[],this._totalLength=0}get encoding(){return this._encoding}append(e){let t=typeof e==`string`?this.fromString(e,this._encoding):e;this._chunks.push(t),this._totalLength+=t.byteLength}tryReadHeaders(e=!1){if(this._chunks.length===0)return;let t=0,n=0,r=0,i=0;row:for(;n<this._chunks.length;){let e=this._chunks[n];r=0;column:for(;r<e.length;){switch(e[r]){case 13:switch(t){case 0:t=1;break;case 2:t=3;break;default:t=0}break;case 10:switch(t){case 1:t=2;break;case 3:t=4,r++;break row;default:t=0}break;default:t=0}r++}i+=e.byteLength,n++}if(t!==4)return;let a=this._read(i+r),o=new Map,s=this.toString(a,`ascii`).split(`\r
`);if(s.length<2)return o;for(let t=0;t<s.length-2;t++){let n=s[t],r=n.indexOf(`:`);if(r===-1)throw Error(`Message header must separate key and value using ':'\n${n}`);let i=n.substr(0,r),a=n.substr(r+1).trim();o.set(e?i.toLowerCase():i,a)}return o}tryReadBody(e){if(!(this._totalLength<e))return this._read(e)}get numberOfBytes(){return this._totalLength}_read(e){if(e===0)return this.emptyBuffer();if(e>this._totalLength)throw Error(`Cannot read so many bytes!`);if(this._chunks[0].byteLength===e){let t=this._chunks[0];return this._chunks.shift(),this._totalLength-=e,this.asNative(t)}if(this._chunks[0].byteLength>e){let t=this._chunks[0],n=this.asNative(t,e);return this._chunks[0]=t.slice(e),this._totalLength-=e,n}let t=this.allocNative(e),n=0;for(;e>0;){let r=this._chunks[0];if(r.byteLength>e){let i=r.slice(0,e);t.set(i,n),n+=e,this._chunks[0]=r.slice(e),this._totalLength-=e,e-=e}else t.set(r,n),n+=r.byteLength,this._chunks.shift(),this._totalLength-=r.byteLength,e-=r.byteLength}return t}}})),_=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.createMessageConnection=e.ConnectionOptions=e.MessageStrategy=e.CancellationStrategy=e.CancellationSenderStrategy=e.CancellationReceiverStrategy=e.RequestCancellationReceiverStrategy=e.IdCancellationReceiverStrategy=e.ConnectionStrategy=e.ConnectionError=e.ConnectionErrors=e.LogTraceNotification=e.SetTraceNotification=e.TraceFormat=e.TraceValues=e.Trace=e.NullLogger=e.ProgressType=e.ProgressToken=void 0;let t=p(),n=l(),r=u(),i=d(),a=m(),o=ee();var s;(function(e){e.type=new r.NotificationType(`$/cancelRequest`)})(s||={});var c;(function(e){function t(e){return typeof e==`string`||typeof e==`number`}e.is=t})(c||(e.ProgressToken=c={}));var f;(function(e){e.type=new r.NotificationType(`$/progress`)})(f||={}),e.ProgressType=class{constructor(){}};var te;(function(e){function t(e){return n.func(e)}e.is=t})(te||={}),e.NullLogger=Object.freeze({error:()=>{},warn:()=>{},info:()=>{},log:()=>{}});var h;(function(e){e[e.Off=0]=`Off`,e[e.Messages=1]=`Messages`,e[e.Compact=2]=`Compact`,e[e.Verbose=3]=`Verbose`})(h||(e.Trace=h={}));var ne;(function(e){e.Off=`off`,e.Messages=`messages`,e.Compact=`compact`,e.Verbose=`verbose`})(ne||(e.TraceValues=ne={})),(function(e){function t(t){if(!n.string(t))return e.Off;switch(t=t.toLowerCase(),t){case`off`:return e.Off;case`messages`:return e.Messages;case`compact`:return e.Compact;case`verbose`:return e.Verbose;default:return e.Off}}e.fromString=t;function r(t){switch(t){case e.Off:return`off`;case e.Messages:return`messages`;case e.Compact:return`compact`;case e.Verbose:return`verbose`;default:return`off`}}e.toString=r})(h||(e.Trace=h={}));var g;(function(e){e.Text=`text`,e.JSON=`json`})(g||(e.TraceFormat=g={})),(function(e){function t(t){return n.string(t)?(t=t.toLowerCase(),t===`json`?e.JSON:e.Text):e.Text}e.fromString=t})(g||(e.TraceFormat=g={}));var re;(function(e){e.type=new r.NotificationType(`$/setTrace`)})(re||(e.SetTraceNotification=re={}));var _;(function(e){e.type=new r.NotificationType(`$/logTrace`)})(_||(e.LogTraceNotification=_={}));var v;(function(e){e[e.Closed=1]=`Closed`,e[e.Disposed=2]=`Disposed`,e[e.AlreadyListening=3]=`AlreadyListening`})(v||(e.ConnectionErrors=v={}));var y=class e extends Error{constructor(t,n){super(n),this.code=t,Object.setPrototypeOf(this,e.prototype)}};e.ConnectionError=y;var b;(function(e){function t(e){let t=e;return t&&n.func(t.cancelUndispatched)}e.is=t})(b||(e.ConnectionStrategy=b={}));var x;(function(e){function t(e){let t=e;return t&&(t.kind===void 0||t.kind===`id`)&&n.func(t.createCancellationTokenSource)&&(t.dispose===void 0||n.func(t.dispose))}e.is=t})(x||(e.IdCancellationReceiverStrategy=x={}));var S;(function(e){function t(e){let t=e;return t&&t.kind===`request`&&n.func(t.createCancellationTokenSource)&&(t.dispose===void 0||n.func(t.dispose))}e.is=t})(S||(e.RequestCancellationReceiverStrategy=S={}));var C;(function(e){e.Message=Object.freeze({createCancellationTokenSource(e){return new o.CancellationTokenSource}});function t(e){return x.is(e)||S.is(e)}e.is=t})(C||(e.CancellationReceiverStrategy=C={}));var w;(function(e){e.Message=Object.freeze({sendCancellation(e,t){return e.sendNotification(s.type,{id:t})},cleanup(e){}});function t(e){let t=e;return t&&n.func(t.sendCancellation)&&n.func(t.cleanup)}e.is=t})(w||(e.CancellationSenderStrategy=w={}));var T;(function(e){e.Message=Object.freeze({receiver:C.Message,sender:w.Message});function t(e){let t=e;return t&&C.is(t.receiver)&&w.is(t.sender)}e.is=t})(T||(e.CancellationStrategy=T={}));var E;(function(e){function t(e){let t=e;return t&&n.func(t.handleMessage)}e.is=t})(E||(e.MessageStrategy=E={}));var D;(function(e){function t(e){let t=e;return t&&(T.is(t.cancellationStrategy)||b.is(t.connectionStrategy)||E.is(t.messageStrategy))}e.is=t})(D||(e.ConnectionOptions=D={}));var O;(function(e){e[e.New=1]=`New`,e[e.Listening=2]=`Listening`,e[e.Closed=3]=`Closed`,e[e.Disposed=4]=`Disposed`})(O||={});function k(l,u,d,p){let m=d===void 0?e.NullLogger:d,ee=0,ne=0,b=0,S,C=new Map,w,D=new Map,k=new Map,A,j=new i.LinkedMap,M=new Map,N=new Set,P=new Map,F=h.Off,I=g.Text,L,R=O.New,ie=new a.Emitter,ae=new a.Emitter,oe=new a.Emitter,se=new a.Emitter,z=new a.Emitter,B=p&&p.cancellationStrategy?p.cancellationStrategy:T.Message;function ce(e){if(e===null)throw Error(`Can't send requests with id null since the response can't be correlated.`);return`req-`+e.toString()}function le(e){return e===null?`res-unknown-`+(++b).toString():`res-`+e.toString()}function ue(){return`not-`+(++ne).toString()}function de(e,t){r.Message.isRequest(t)?e.set(ce(t.id),t):r.Message.isResponse(t)?e.set(le(t.id),t):e.set(ue(),t)}function fe(e){}function pe(){return R===O.Listening}function me(){return R===O.Closed}function V(){return R===O.Disposed}function he(){(R===O.New||R===O.Listening)&&(R=O.Closed,ae.fire(void 0))}function ge(e){ie.fire([e,void 0,void 0])}function _e(e){ie.fire(e)}l.onClose(he),l.onError(ge),u.onClose(he),u.onError(_e);function ve(){A||j.size===0||(A=(0,t.default)().timer.setImmediate(()=>{A=void 0,be()}))}function ye(e){r.Message.isRequest(e)?Se(e):r.Message.isNotification(e)?we(e):r.Message.isResponse(e)?Ce(e):Te(e)}function be(){if(j.size===0)return;let e=j.shift();try{let t=p?.messageStrategy;E.is(t)?t.handleMessage(e,ye):ye(e)}finally{ve()}}let xe=e=>{try{if(r.Message.isNotification(e)&&e.method===s.type.method){let t=e.params.id,n=ce(t),i=j.get(n);if(r.Message.isRequest(i)){let r=p?.connectionStrategy,a=r&&r.cancelUndispatched?r.cancelUndispatched(i,fe):void 0;if(a&&(a.error!==void 0||a.result!==void 0)){j.delete(n),P.delete(t),a.id=i.id,U(a,e.method,Date.now()),u.write(a).catch(()=>m.error(`Sending response for canceled message failed.`));return}}let a=P.get(t);if(a!==void 0){a.cancel(),W(e);return}else N.add(t)}de(j,e)}finally{ve()}};function Se(e){if(V())return;function t(t,n,i){let a={jsonrpc:`2.0`,id:e.id};t instanceof r.ResponseError?a.error=t.toJson():a.result=t===void 0?null:t,U(a,n,i),u.write(a).catch(()=>m.error(`Sending response failed.`))}function i(t,n,r){let i={jsonrpc:`2.0`,id:e.id,error:t.toJson()};U(i,n,r),u.write(i).catch(()=>m.error(`Sending response failed.`))}function a(t,n,r){t===void 0&&(t=null);let i={jsonrpc:`2.0`,id:e.id,result:t};U(i,n,r),u.write(i).catch(()=>m.error(`Sending response failed.`))}Oe(e);let o=C.get(e.method),s,c;o&&(s=o.type,c=o.handler);let l=Date.now();if(c||S){let o=e.id??String(Date.now()),u=x.is(B.receiver)?B.receiver.createCancellationTokenSource(o):B.receiver.createCancellationTokenSource(e);e.id!==null&&N.has(e.id)&&u.cancel(),e.id!==null&&P.set(o,u);try{let d;if(c)if(e.params===void 0){if(s!==void 0&&s.numberOfParams!==0){i(new r.ResponseError(r.ErrorCodes.InvalidParams,`Request ${e.method} defines ${s.numberOfParams} params but received none.`),e.method,l);return}d=c(u.token)}else if(Array.isArray(e.params)){if(s!==void 0&&s.parameterStructures===r.ParameterStructures.byName){i(new r.ResponseError(r.ErrorCodes.InvalidParams,`Request ${e.method} defines parameters by name but received parameters by position`),e.method,l);return}d=c(...e.params,u.token)}else{if(s!==void 0&&s.parameterStructures===r.ParameterStructures.byPosition){i(new r.ResponseError(r.ErrorCodes.InvalidParams,`Request ${e.method} defines parameters by position but received parameters by name`),e.method,l);return}d=c(e.params,u.token)}else S&&(d=S(e.method,e.params,u.token));let f=d;d?f.then?f.then(n=>{P.delete(o),t(n,e.method,l)},t=>{P.delete(o),t instanceof r.ResponseError?i(t,e.method,l):t&&n.string(t.message)?i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed with message: ${t.message}`),e.method,l):i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed unexpectedly without providing any details.`),e.method,l)}):(P.delete(o),t(d,e.method,l)):(P.delete(o),a(d,e.method,l))}catch(a){P.delete(o),a instanceof r.ResponseError?t(a,e.method,l):a&&n.string(a.message)?i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed with message: ${a.message}`),e.method,l):i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed unexpectedly without providing any details.`),e.method,l)}}else i(new r.ResponseError(r.ErrorCodes.MethodNotFound,`Unhandled method ${e.method}`),e.method,l)}function Ce(e){if(!V())if(e.id===null)e.error?m.error(`Received response message without id: Error is: \n${JSON.stringify(e.error,void 0,4)}`):m.error(`Received response message without id. No further error information provided.`);else{let t=e.id,n=M.get(t);if(ke(e,n),n!==void 0){M.delete(t);try{if(e.error){let t=e.error;n.reject(new r.ResponseError(t.code,t.message,t.data))}else if(e.result!==void 0)n.resolve(e.result);else throw Error(`Should never happen.`)}catch(e){e.message?m.error(`Response handler '${n.method}' failed with message: ${e.message}`):m.error(`Response handler '${n.method}' failed unexpectedly.`)}}}}function we(e){if(V())return;let t,n;if(e.method===s.type.method){let t=e.params.id;N.delete(t),W(e);return}else{let r=D.get(e.method);r&&(n=r.handler,t=r.type)}if(n||w)try{if(W(e),n)if(e.params===void 0)t!==void 0&&t.numberOfParams!==0&&t.parameterStructures!==r.ParameterStructures.byName&&m.error(`Notification ${e.method} defines ${t.numberOfParams} params but received none.`),n();else if(Array.isArray(e.params)){let i=e.params;e.method===f.type.method&&i.length===2&&c.is(i[0])?n({token:i[0],value:i[1]}):(t!==void 0&&(t.parameterStructures===r.ParameterStructures.byName&&m.error(`Notification ${e.method} defines parameters by name but received parameters by position`),t.numberOfParams!==e.params.length&&m.error(`Notification ${e.method} defines ${t.numberOfParams} params but received ${i.length} arguments`)),n(...i))}else t!==void 0&&t.parameterStructures===r.ParameterStructures.byPosition&&m.error(`Notification ${e.method} defines parameters by position but received parameters by name`),n(e.params);else w&&w(e.method,e.params)}catch(t){t.message?m.error(`Notification handler '${e.method}' failed with message: ${t.message}`):m.error(`Notification handler '${e.method}' failed unexpectedly.`)}else oe.fire(e)}function Te(e){if(!e){m.error(`Received empty message.`);return}m.error(`Received message which is neither a response nor a notification message:\n${JSON.stringify(e,null,4)}`);let t=e;if(n.string(t.id)||n.number(t.id)){let e=t.id,n=M.get(e);n&&n.reject(Error(`The received response has neither a result nor an error property.`))}}function H(e){if(e!=null)switch(F){case h.Verbose:return JSON.stringify(e,null,4);case h.Compact:return JSON.stringify(e);default:return}}function Ee(e){if(!(F===h.Off||!L))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&e.params&&(t=`Params: ${H(e.params)}\n\n`),L.log(`Sending request '${e.method} - (${e.id})'.`,t)}else G(`send-request`,e)}function De(e){if(!(F===h.Off||!L))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&(t=e.params?`Params: ${H(e.params)}\n\n`:`No parameters provided.

`),L.log(`Sending notification '${e.method}'.`,t)}else G(`send-notification`,e)}function U(e,t,n){if(!(F===h.Off||!L))if(I===g.Text){let r;(F===h.Verbose||F===h.Compact)&&(e.error&&e.error.data?r=`Error data: ${H(e.error.data)}\n\n`:e.result?r=`Result: ${H(e.result)}\n\n`:e.error===void 0&&(r=`No result returned.

`)),L.log(`Sending response '${t} - (${e.id})'. Processing request took ${Date.now()-n}ms`,r)}else G(`send-response`,e)}function Oe(e){if(!(F===h.Off||!L))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&e.params&&(t=`Params: ${H(e.params)}\n\n`),L.log(`Received request '${e.method} - (${e.id})'.`,t)}else G(`receive-request`,e)}function W(e){if(!(F===h.Off||!L||e.method===_.type.method))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&(t=e.params?`Params: ${H(e.params)}\n\n`:`No parameters provided.

`),L.log(`Received notification '${e.method}'.`,t)}else G(`receive-notification`,e)}function ke(e,t){if(!(F===h.Off||!L))if(I===g.Text){let n;if((F===h.Verbose||F===h.Compact)&&(e.error&&e.error.data?n=`Error data: ${H(e.error.data)}\n\n`:e.result?n=`Result: ${H(e.result)}\n\n`:e.error===void 0&&(n=`No result returned.

`)),t){let r=e.error?` Request failed: ${e.error.message} (${e.error.code}).`:``;L.log(`Received response '${t.method} - (${e.id})' in ${Date.now()-t.timerStart}ms.${r}`,n)}else L.log(`Received response ${e.id} without active response promise.`,n)}else G(`receive-response`,e)}function G(e,t){if(!L||F===h.Off)return;let n={isLSPMessage:!0,type:e,message:t,timestamp:Date.now()};L.log(n)}function K(){if(me())throw new y(v.Closed,`Connection is closed.`);if(V())throw new y(v.Disposed,`Connection is disposed.`)}function Ae(){if(pe())throw new y(v.AlreadyListening,`Connection is already listening`)}function q(){if(!pe())throw Error(`Call listen() first.`)}function J(e){return e===void 0?null:e}function je(e){if(e!==null)return e}function Me(e){return e!=null&&!Array.isArray(e)&&typeof e==`object`}function Y(e,t){switch(e){case r.ParameterStructures.auto:return Me(t)?je(t):[J(t)];case r.ParameterStructures.byName:if(!Me(t))throw Error(`Received parameters by name but param is not an object literal.`);return je(t);case r.ParameterStructures.byPosition:return[J(t)];default:throw Error(`Unknown parameter structure ${e.toString()}`)}}function Ne(e,t){let n,r=e.numberOfParams;switch(r){case 0:n=void 0;break;case 1:n=Y(e.parameterStructures,t[0]);break;default:n=[];for(let e=0;e<t.length&&e<r;e++)n.push(J(t[e]));if(t.length<r)for(let e=t.length;e<r;e++)n.push(null);break}return n}let X={sendNotification:(e,...t)=>{K();let i,a;if(n.string(e)){i=e;let n=t[0],o=0,s=r.ParameterStructures.auto;r.ParameterStructures.is(n)&&(o=1,s=n);let c=t.length,l=c-o;switch(l){case 0:a=void 0;break;case 1:a=Y(s,t[o]);break;default:if(s===r.ParameterStructures.byName)throw Error(`Received ${l} parameters for 'by Name' notification parameter structure.`);a=t.slice(o,c).map(e=>J(e));break}}else{let n=t;i=e.method,a=Ne(e,n)}let o={jsonrpc:`2.0`,method:i,params:a};return De(o),u.write(o).catch(e=>{throw m.error(`Sending notification failed.`),e})},onNotification:(e,t)=>{K();let r;return n.func(e)?w=e:t&&(n.string(e)?(r=e,D.set(e,{type:void 0,handler:t})):(r=e.method,D.set(e.method,{type:e,handler:t}))),{dispose:()=>{r===void 0?w=void 0:D.delete(r)}}},onProgress:(e,t,n)=>{if(k.has(t))throw Error(`Progress handler for token ${t} already registered`);return k.set(t,n),{dispose:()=>{k.delete(t)}}},sendProgress:(e,t,n)=>X.sendNotification(f.type,{token:t,value:n}),onUnhandledProgress:se.event,sendRequest:(e,...t)=>{K(),q();let i,a,s;if(n.string(e)){i=e;let n=t[0],c=t[t.length-1],l=0,u=r.ParameterStructures.auto;r.ParameterStructures.is(n)&&(l=1,u=n);let d=t.length;o.CancellationToken.is(c)&&(--d,s=c);let f=d-l;switch(f){case 0:a=void 0;break;case 1:a=Y(u,t[l]);break;default:if(u===r.ParameterStructures.byName)throw Error(`Received ${f} parameters for 'by Name' request parameter structure.`);a=t.slice(l,d).map(e=>J(e));break}}else{let n=t;i=e.method,a=Ne(e,n);let r=e.numberOfParams;s=o.CancellationToken.is(n[r])?n[r]:void 0}let c=ee++,l;s&&(l=s.onCancellationRequested(()=>{let e=B.sender.sendCancellation(X,c);return e===void 0?(m.log(`Received no promise from cancellation strategy when cancelling id ${c}`),Promise.resolve()):e.catch(()=>{m.log(`Sending cancellation messages for id ${c} failed`)})}));let d={jsonrpc:`2.0`,id:c,method:i,params:a};return Ee(d),typeof B.sender.enableCancellation==`function`&&B.sender.enableCancellation(d),new Promise(async(e,t)=>{let n={method:i,timerStart:Date.now(),resolve:t=>{e(t),B.sender.cleanup(c),l?.dispose()},reject:e=>{t(e),B.sender.cleanup(c),l?.dispose()}};try{M.set(c,n),await u.write(d)}catch(e){throw M.delete(c),n.reject(new r.ResponseError(r.ErrorCodes.MessageWriteError,e.message?e.message:`Unknown reason`)),m.error(`Sending request failed.`),e}})},onRequest:(e,t)=>{K();let r=null;return te.is(e)?(r=void 0,S=e):n.string(e)?(r=null,t!==void 0&&(r=e,C.set(e,{handler:t,type:void 0}))):t!==void 0&&(r=e.method,C.set(e.method,{type:e,handler:t})),{dispose:()=>{r!==null&&(r===void 0?S=void 0:C.delete(r))}}},hasPendingResponse:()=>M.size>0,trace:async(e,t,r)=>{let i=!1,a=g.Text;r!==void 0&&(n.boolean(r)?i=r:(i=r.sendNotification||!1,a=r.traceFormat||g.Text)),F=e,I=a,L=F===h.Off?void 0:t,i&&!me()&&!V()&&await X.sendNotification(re.type,{value:h.toString(e)})},onError:ie.event,onClose:ae.event,onUnhandledNotification:oe.event,onDispose:z.event,end:()=>{u.end()},dispose:()=>{if(V())return;R=O.Disposed,z.fire(void 0);let e=new r.ResponseError(r.ErrorCodes.PendingResponseRejected,`Pending response rejected since connection got disposed`);for(let t of M.values())t.reject(e);M=new Map,P=new Map,N=new Set,j=new i.LinkedMap,n.func(u.dispose)&&u.dispose(),n.func(l.dispose)&&l.dispose()},listen:()=>{K(),Ae(),R=O.Listening,l.listen(xe)},inspect:()=>{(0,t.default)().console.log(`inspect`)}};return X.onNotification(_.type,e=>{if(F===h.Off||!L)return;let t=F===h.Verbose||F===h.Compact;L.log(e.message,t?e.verbose:void 0)}),X.onNotification(f.type,e=>{let t=k.get(e.token);t?t(e.value):se.fire(e)}),X}e.createMessageConnection=k})),v=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.ProgressType=e.ProgressToken=e.createMessageConnection=e.NullLogger=e.ConnectionOptions=e.ConnectionStrategy=e.AbstractMessageBuffer=e.WriteableStreamMessageWriter=e.AbstractMessageWriter=e.MessageWriter=e.ReadableStreamMessageReader=e.AbstractMessageReader=e.MessageReader=e.SharedArrayReceiverStrategy=e.SharedArraySenderStrategy=e.CancellationToken=e.CancellationTokenSource=e.Emitter=e.Event=e.Disposable=e.LRUCache=e.Touch=e.LinkedMap=e.ParameterStructures=e.NotificationType9=e.NotificationType8=e.NotificationType7=e.NotificationType6=e.NotificationType5=e.NotificationType4=e.NotificationType3=e.NotificationType2=e.NotificationType1=e.NotificationType0=e.NotificationType=e.ErrorCodes=e.ResponseError=e.RequestType9=e.RequestType8=e.RequestType7=e.RequestType6=e.RequestType5=e.RequestType4=e.RequestType3=e.RequestType2=e.RequestType1=e.RequestType0=e.RequestType=e.Message=e.RAL=void 0,e.MessageStrategy=e.CancellationStrategy=e.CancellationSenderStrategy=e.CancellationReceiverStrategy=e.ConnectionError=e.ConnectionErrors=e.LogTraceNotification=e.SetTraceNotification=e.TraceFormat=e.TraceValues=e.Trace=void 0;let t=u();Object.defineProperty(e,`Message`,{enumerable:!0,get:function(){return t.Message}}),Object.defineProperty(e,`RequestType`,{enumerable:!0,get:function(){return t.RequestType}}),Object.defineProperty(e,`RequestType0`,{enumerable:!0,get:function(){return t.RequestType0}}),Object.defineProperty(e,`RequestType1`,{enumerable:!0,get:function(){return t.RequestType1}}),Object.defineProperty(e,`RequestType2`,{enumerable:!0,get:function(){return t.RequestType2}}),Object.defineProperty(e,`RequestType3`,{enumerable:!0,get:function(){return t.RequestType3}}),Object.defineProperty(e,`RequestType4`,{enumerable:!0,get:function(){return t.RequestType4}}),Object.defineProperty(e,`RequestType5`,{enumerable:!0,get:function(){return t.RequestType5}}),Object.defineProperty(e,`RequestType6`,{enumerable:!0,get:function(){return t.RequestType6}}),Object.defineProperty(e,`RequestType7`,{enumerable:!0,get:function(){return t.RequestType7}}),Object.defineProperty(e,`RequestType8`,{enumerable:!0,get:function(){return t.RequestType8}}),Object.defineProperty(e,`RequestType9`,{enumerable:!0,get:function(){return t.RequestType9}}),Object.defineProperty(e,`ResponseError`,{enumerable:!0,get:function(){return t.ResponseError}}),Object.defineProperty(e,`ErrorCodes`,{enumerable:!0,get:function(){return t.ErrorCodes}}),Object.defineProperty(e,`NotificationType`,{enumerable:!0,get:function(){return t.NotificationType}}),Object.defineProperty(e,`NotificationType0`,{enumerable:!0,get:function(){return t.NotificationType0}}),Object.defineProperty(e,`NotificationType1`,{enumerable:!0,get:function(){return t.NotificationType1}}),Object.defineProperty(e,`NotificationType2`,{enumerable:!0,get:function(){return t.NotificationType2}}),Object.defineProperty(e,`NotificationType3`,{enumerable:!0,get:function(){return t.NotificationType3}}),Object.defineProperty(e,`NotificationType4`,{enumerable:!0,get:function(){return t.NotificationType4}}),Object.defineProperty(e,`NotificationType5`,{enumerable:!0,get:function(){return t.NotificationType5}}),Object.defineProperty(e,`NotificationType6`,{enumerable:!0,get:function(){return t.NotificationType6}}),Object.defineProperty(e,`NotificationType7`,{enumerable:!0,get:function(){return t.NotificationType7}}),Object.defineProperty(e,`NotificationType8`,{enumerable:!0,get:function(){return t.NotificationType8}}),Object.defineProperty(e,`NotificationType9`,{enumerable:!0,get:function(){return t.NotificationType9}}),Object.defineProperty(e,`ParameterStructures`,{enumerable:!0,get:function(){return t.ParameterStructures}});let n=d();Object.defineProperty(e,`LinkedMap`,{enumerable:!0,get:function(){return n.LinkedMap}}),Object.defineProperty(e,`LRUCache`,{enumerable:!0,get:function(){return n.LRUCache}}),Object.defineProperty(e,`Touch`,{enumerable:!0,get:function(){return n.Touch}});let r=f();Object.defineProperty(e,`Disposable`,{enumerable:!0,get:function(){return r.Disposable}});let i=m();Object.defineProperty(e,`Event`,{enumerable:!0,get:function(){return i.Event}}),Object.defineProperty(e,`Emitter`,{enumerable:!0,get:function(){return i.Emitter}});let a=ee();Object.defineProperty(e,`CancellationTokenSource`,{enumerable:!0,get:function(){return a.CancellationTokenSource}}),Object.defineProperty(e,`CancellationToken`,{enumerable:!0,get:function(){return a.CancellationToken}});let o=te();Object.defineProperty(e,`SharedArraySenderStrategy`,{enumerable:!0,get:function(){return o.SharedArraySenderStrategy}}),Object.defineProperty(e,`SharedArrayReceiverStrategy`,{enumerable:!0,get:function(){return o.SharedArrayReceiverStrategy}});let s=ne();Object.defineProperty(e,`MessageReader`,{enumerable:!0,get:function(){return s.MessageReader}}),Object.defineProperty(e,`AbstractMessageReader`,{enumerable:!0,get:function(){return s.AbstractMessageReader}}),Object.defineProperty(e,`ReadableStreamMessageReader`,{enumerable:!0,get:function(){return s.ReadableStreamMessageReader}});let c=g();Object.defineProperty(e,`MessageWriter`,{enumerable:!0,get:function(){return c.MessageWriter}}),Object.defineProperty(e,`AbstractMessageWriter`,{enumerable:!0,get:function(){return c.AbstractMessageWriter}}),Object.defineProperty(e,`WriteableStreamMessageWriter`,{enumerable:!0,get:function(){return c.WriteableStreamMessageWriter}});let l=re();Object.defineProperty(e,`AbstractMessageBuffer`,{enumerable:!0,get:function(){return l.AbstractMessageBuffer}});let h=_();Object.defineProperty(e,`ConnectionStrategy`,{enumerable:!0,get:function(){return h.ConnectionStrategy}}),Object.defineProperty(e,`ConnectionOptions`,{enumerable:!0,get:function(){return h.ConnectionOptions}}),Object.defineProperty(e,`NullLogger`,{enumerable:!0,get:function(){return h.NullLogger}}),Object.defineProperty(e,`createMessageConnection`,{enumerable:!0,get:function(){return h.createMessageConnection}}),Object.defineProperty(e,`ProgressToken`,{enumerable:!0,get:function(){return h.ProgressToken}}),Object.defineProperty(e,`ProgressType`,{enumerable:!0,get:function(){return h.ProgressType}}),Object.defineProperty(e,`Trace`,{enumerable:!0,get:function(){return h.Trace}}),Object.defineProperty(e,`TraceValues`,{enumerable:!0,get:function(){return h.TraceValues}}),Object.defineProperty(e,`TraceFormat`,{enumerable:!0,get:function(){return h.TraceFormat}}),Object.defineProperty(e,`SetTraceNotification`,{enumerable:!0,get:function(){return h.SetTraceNotification}}),Object.defineProperty(e,`LogTraceNotification`,{enumerable:!0,get:function(){return h.LogTraceNotification}}),Object.defineProperty(e,`ConnectionErrors`,{enumerable:!0,get:function(){return h.ConnectionErrors}}),Object.defineProperty(e,`ConnectionError`,{enumerable:!0,get:function(){return h.ConnectionError}}),Object.defineProperty(e,`CancellationReceiverStrategy`,{enumerable:!0,get:function(){return h.CancellationReceiverStrategy}}),Object.defineProperty(e,`CancellationSenderStrategy`,{enumerable:!0,get:function(){return h.CancellationSenderStrategy}}),Object.defineProperty(e,`CancellationStrategy`,{enumerable:!0,get:function(){return h.CancellationStrategy}}),Object.defineProperty(e,`MessageStrategy`,{enumerable:!0,get:function(){return h.MessageStrategy}}),e.RAL=p().default})),y=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0});let t=v();var n=class e extends t.AbstractMessageBuffer{constructor(e=`utf-8`){super(e),this.asciiDecoder=new TextDecoder(`ascii`)}emptyBuffer(){return e.emptyBuffer}fromString(e,t){return new TextEncoder().encode(e)}toString(e,t){return t===`ascii`?this.asciiDecoder.decode(e):new TextDecoder(t).decode(e)}asNative(e,t){return t===void 0?e:e.slice(0,t)}allocNative(e){return new Uint8Array(e)}};n.emptyBuffer=new Uint8Array;var r=class{constructor(e){this.socket=e,this._onData=new t.Emitter,this._messageListener=e=>{e.data.arrayBuffer().then(e=>{this._onData.fire(new Uint8Array(e))},()=>{(0,t.RAL)().console.error(`Converting blob to array buffer failed.`)})},this.socket.addEventListener(`message`,this._messageListener)}onClose(e){return this.socket.addEventListener(`close`,e),t.Disposable.create(()=>this.socket.removeEventListener(`close`,e))}onError(e){return this.socket.addEventListener(`error`,e),t.Disposable.create(()=>this.socket.removeEventListener(`error`,e))}onEnd(e){return this.socket.addEventListener(`end`,e),t.Disposable.create(()=>this.socket.removeEventListener(`end`,e))}onData(e){return this._onData.event(e)}},i=class{constructor(e){this.socket=e}onClose(e){return this.socket.addEventListener(`close`,e),t.Disposable.create(()=>this.socket.removeEventListener(`close`,e))}onError(e){return this.socket.addEventListener(`error`,e),t.Disposable.create(()=>this.socket.removeEventListener(`error`,e))}onEnd(e){return this.socket.addEventListener(`end`,e),t.Disposable.create(()=>this.socket.removeEventListener(`end`,e))}write(e,t){if(typeof e==`string`){if(t!==void 0&&t!==`utf-8`)throw Error(`In a Browser environments only utf-8 text encoding is supported. But got encoding: ${t}`);this.socket.send(e)}else this.socket.send(e);return Promise.resolve()}end(){this.socket.close()}};let a=new TextEncoder,o=Object.freeze({messageBuffer:Object.freeze({create:e=>new n(e)}),applicationJson:Object.freeze({encoder:Object.freeze({name:`application/json`,encode:(e,t)=>{if(t.charset!==`utf-8`)throw Error(`In a Browser environments only utf-8 text encoding is supported. But got encoding: ${t.charset}`);return Promise.resolve(a.encode(JSON.stringify(e,void 0,0)))}}),decoder:Object.freeze({name:`application/json`,decode:(e,t)=>{if(!(e instanceof Uint8Array))throw Error(`In a Browser environments only Uint8Arrays are supported.`);return Promise.resolve(JSON.parse(new TextDecoder(t.charset).decode(e)))}})}),stream:Object.freeze({asReadableStream:e=>new r(e),asWritableStream:e=>new i(e)}),console,timer:Object.freeze({setTimeout(e,t,...n){let r=setTimeout(e,t,...n);return{dispose:()=>clearTimeout(r)}},setImmediate(e,...t){let n=setTimeout(e,0,...t);return{dispose:()=>clearTimeout(n)}},setInterval(e,t,...n){let r=setInterval(e,t,...n);return{dispose:()=>clearInterval(r)}}})});function s(){return o}(function(e){function n(){t.RAL.install(o)}e.install=n})(s||={}),e.default=s}));const b=c(o((e=>{var t=e&&e.__createBinding||(Object.create?(function(e,t,n,r){r===void 0&&(r=n);var i=Object.getOwnPropertyDescriptor(t,n);(!i||(`get`in i?!t.__esModule:i.writable||i.configurable))&&(i={enumerable:!0,get:function(){return t[n]}}),Object.defineProperty(e,r,i)}):(function(e,t,n,r){r===void 0&&(r=n),e[r]=t[n]})),n=e&&e.__exportStar||function(e,n){for(var r in e)r!==`default`&&!Object.prototype.hasOwnProperty.call(n,r)&&t(n,e,r)};Object.defineProperty(e,`__esModule`,{value:!0}),e.createMessageConnection=e.BrowserMessageWriter=e.BrowserMessageReader=void 0,y().default.install();let r=v();n(v(),e),e.BrowserMessageReader=class extends r.AbstractMessageReader{constructor(e){super(),this._onData=new r.Emitter,this._messageListener=e=>{this._onData.fire(e.data)},e.addEventListener(`error`,e=>this.fireError(e)),e.onmessage=this._messageListener}listen(e){return this._onData.event(e)}},e.BrowserMessageWriter=class extends r.AbstractMessageWriter{constructor(e){super(),this.port=e,this.errorCount=0,e.addEventListener(`error`,e=>this.fireError(e))}write(e){try{return this.port.postMessage(e),Promise.resolve()}catch(t){return this.handleError(t,e),Promise.reject(t)}}handleError(e,t){this.errorCount++,this.fireError(e,t,this.errorCount)}end(){}};function i(e,t,n,i){return n===void 0&&(n=r.NullLogger),r.ConnectionStrategy.is(i)&&(i={connectionStrategy:i}),(0,r.createMessageConnection)(e,t,n,i)}e.createMessageConnection=i}))(),1).default,x=b.BrowserMessageReader,S=b.BrowserMessageWriter;var C=class extends Error{code;phase;runtimeId;profileId;recoverable;constructor(e,t){super(e,{cause:t.cause}),this.name=`WasmIdleError`,this.code=t.code,this.phase=t.phase,this.runtimeId=t.runtimeId,this.profileId=t.profileId,this.recoverable=t.recoverable??!1}},w=class extends C{constructor(e,t={}){super(e,{...t,code:`asset-integrity`,phase:t.phase??`asset`,recoverable:t.recoverable??!1}),this.name=`AssetIntegrityError`}};function T(e){if(e.schemaVersion!==1)throw TypeError(`Unsupported runtime trust profile schema: ${String(e.schemaVersion)}`);if(!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(e.profileId))throw TypeError(`Runtime trust profile ID must be a non-empty stable identifier`);if(![`none`,`allowlist`,`unrestricted`].includes(e.network.mode))throw TypeError(`Unsupported runtime network mode: ${String(e.network.mode)}`);let t=e.network.allowedOrigins.map(e=>{let t;try{t=new URL(e)}catch{throw TypeError(`Runtime network allowlist contains an invalid origin: ${e}`)}if(t.protocol!==`https:`&&t.protocol!==`http:`||t.pathname!==`/`||t.search||t.hash||t.username||t.password)throw TypeError(`Runtime network allowlist requires HTTP(S) origins: ${e}`);return t.origin}),n=[...new Set(t)].sort();if(e.network.mode===`allowlist`&&n.length===0)throw TypeError(`Runtime network allowlist mode requires at least one origin`);if(e.network.mode!==`allowlist`&&n.length>0)throw TypeError(`Runtime network mode ${e.network.mode} cannot declare allowed origins`);if(![`none`,`ephemeral`,`persistent`].includes(e.storage.mode))throw TypeError(`Unsupported runtime storage mode: ${String(e.storage.mode)}`);if(![`none`,`allowlist`].includes(e.environment.mode))throw TypeError(`Unsupported runtime environment mode: ${String(e.environment.mode)}`);for(let t of e.environment.allowedNames)if(!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(t))throw TypeError(`Runtime environment allowlist contains an invalid name: ${t}`);let r=[...new Set(e.environment.allowedNames)].sort();if(e.environment.mode===`allowlist`&&r.length===0)throw TypeError(`Runtime environment allowlist mode requires at least one name`);if(e.environment.mode===`none`&&r.length>0)throw TypeError(`Runtime environment mode none cannot declare allowed names`);if(!Number.isSafeInteger(e.threads.maxThreads)||e.threads.maxThreads<0)throw TypeError(`Runtime maxThreads must be a non-negative safe integer`);if(!Number.isSafeInteger(e.workers.maxNestedWorkers)||e.workers.maxNestedWorkers<0)throw TypeError(`Runtime maxNestedWorkers must be a non-negative safe integer`);if(typeof e.sharedArrayBuffer!=`boolean`)throw TypeError(`Runtime sharedArrayBuffer capability must be boolean`);if(!e.sharedArrayBuffer&&e.threads.maxThreads>0)throw TypeError(`Runtime threads require SharedArrayBuffer capability`);if(![`none`,`wasm-only`,`javascript-and-wasm`].includes(e.dynamicCode))throw TypeError(`Unsupported runtime dynamic-code mode: ${String(e.dynamicCode)}`);if(typeof e.sameOriginAccess!=`boolean`)throw TypeError(`Runtime sameOriginAccess capability must be boolean`);return Object.freeze({schemaVersion:1,profileId:e.profileId,network:Object.freeze({mode:e.network.mode,allowedOrigins:Object.freeze(n)}),storage:Object.freeze({mode:e.storage.mode}),environment:Object.freeze({mode:e.environment.mode,allowedNames:Object.freeze(r)}),threads:Object.freeze({maxThreads:e.threads.maxThreads}),workers:Object.freeze({maxNestedWorkers:e.workers.maxNestedWorkers}),sharedArrayBuffer:e.sharedArrayBuffer,dynamicCode:e.dynamicCode,sameOriginAccess:e.sameOriginAccess})}T({schemaVersion:1,profileId:`restricted-browser-worker-v1`,network:{mode:`none`,allowedOrigins:[]},storage:{mode:`ephemeral`},environment:{mode:`none`,allowedNames:[]},threads:{maxThreads:0},workers:{maxNestedWorkers:0},sharedArrayBuffer:!1,dynamicCode:`wasm-only`,sameOriginAccess:!1}),5*BigInt64Array.BYTES_PER_ELEMENT,BigInt(2**53-1),typeof SharedArrayBuffer==`function`&&Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,`byteLength`)?.get;const E=new Set([`application/javascript`,`text/javascript`]);async function D(e){let t=e.stage??`compressed`,n={runtimeId:e.runtimeId,profileId:e.profileId};if(!e.asset||e.asset.includes(`\0`))throw new w(`Runtime asset identity must be a non-empty safe string`,n);if(!ArrayBuffer.isView(e.bytes)||Object.prototype.toString.call(e.bytes)!==`[object Uint8Array]`)throw new w(`Runtime asset ${e.asset} did not provide byte data`,n);let r,i,a;if(typeof e.expected==`string`){if(t===`uncompressed`)throw new w(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,n);r=e.expected}else if(e.expected&&typeof e.expected==`object`)if(t===`compressed`)r=e.expected.sha256,i=e.expected.bytes,e.expected.uncompressedSha256===void 0&&e.expected.uncompressedBytes===void 0&&(a=e.expected.mediaType);else{if(e.expected.uncompressedSha256===void 0||e.expected.uncompressedBytes===void 0)throw new w(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,n);r=e.expected.uncompressedSha256,i=e.expected.uncompressedBytes,a=e.expected.mediaType}else throw new w(`Runtime asset ${e.asset} has invalid integrity metadata`,n);if(!/^[a-f0-9]{64}$/u.test(r))throw new w(`Runtime asset ${e.asset} has an invalid expected ${t} SHA-256 digest`,n);if(i!==void 0&&(!Number.isSafeInteger(i)||i<0))throw new w(`Runtime asset ${e.asset} has an invalid expected ${t} byte size`,n);if(i!==void 0&&e.bytes.byteLength!==i)throw new w(`Runtime asset ${e.asset} ${t} size mismatch: expected ${i} bytes, received ${e.bytes.byteLength}`,n);if(a!==void 0){if(!a.includes(`/`))throw new w(`Runtime asset ${e.asset} has an invalid expected MIME type`,n);let t=e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase()||`missing`,r=a.trim().toLowerCase();if(t!==r&&!(E.has(t)&&E.has(r)))throw new w(`Runtime asset ${e.asset} MIME type mismatch: expected ${r}, received ${t}`,n)}if(!globalThis.crypto?.subtle)throw new w(`Web Crypto SHA-256 is unavailable`,n);let o=e.bytes.byteOffset===0&&e.bytes.byteLength===e.bytes.buffer.byteLength&&e.bytes.buffer instanceof ArrayBuffer?e.bytes.buffer:Uint8Array.from(e.bytes).buffer,s=new Uint8Array(await globalThis.crypto.subtle.digest(`SHA-256`,o)),c=Array.from(s,e=>e.toString(16).padStart(2,`0`)).join(``);if(c!==r)throw new w(`Runtime asset ${e.asset} ${t} SHA-256 mismatch: expected ${r}, received ${c}`,n);return Object.freeze({asset:e.asset,stage:t,sha256:c,bytes:e.bytes.byteLength,mediaType:a?e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase():void 0})}const O=Object.freeze(`C.C3.CPP.OBJC.PYTHON3.JAVA.RUST.GO.D.CSHARP.FSHARP.VBNET.ELIXIR.ERLANG.PROLOG.GLEAM.PERL.TCL.AWK.PASCAL.FORTH.J.BQN.JANET.JULIA.NIM.BASH.CLOJURESCRIPT.FORTRAN.LFORTRAN.COBOL.TINYGO.OCAML.JAVASCRIPT.TYPESCRIPT.ASSEMBLYSCRIPT.WAT.WASM.LUA.ZIG.LISP.RUBY.HASKELL.R.OCTAVE.DUCKDB.SQLITE.PHP`.split(`.`)),k=new Set([`C`,`CPP`,`PYTHON3`,`JAVA`]);new Set(O.filter(e=>!k.has(e)));const A={"C#":{canonicalId:`CSHARP`,kind:`spelling`},"F#":{canonicalId:`FSHARP`,kind:`spelling`},VB:{canonicalId:`VBNET`,kind:`spelling`},VISUALBASIC:{canonicalId:`VBNET`,kind:`spelling`},OBJECTIVEC:{canonicalId:`OBJC`,kind:`spelling`},OBJECTIVE_C:{canonicalId:`OBJC`,kind:`spelling`},"OBJECTIVE-C":{canonicalId:`OBJC`,kind:`spelling`},ERL:{canonicalId:`ERLANG`,kind:`spelling`},SWIPL:{canonicalId:`PROLOG`,kind:`implementation`},SWI:{canonicalId:`PROLOG`,kind:`implementation`},TCLSH:{canonicalId:`TCL`,kind:`implementation`},GAWK:{canonicalId:`AWK`,kind:`implementation`},PAS:{canonicalId:`PASCAL`,kind:`spelling`},FPC:{canonicalId:`PASCAL`,kind:`implementation`},GFORTH:{canonicalId:`FORTH`,kind:`implementation`},JL:{canonicalId:`JULIA`,kind:`spelling`},NIMROD:{canonicalId:`NIM`,kind:`spelling`},SH:{canonicalId:`BASH`,kind:`compatibility`},SHELL:{canonicalId:`BASH`,kind:`compatibility`},CLJS:{canonicalId:`CLOJURESCRIPT`,kind:`spelling`},F77:{canonicalId:`FORTRAN`,kind:`dialect`},COB:{canonicalId:`COBOL`,kind:`spelling`},CBL:{canonicalId:`COBOL`,kind:`spelling`},GNUCOBOL:{canonicalId:`COBOL`,kind:`implementation`},DLANG:{canonicalId:`D`,kind:`spelling`},JS:{canonicalId:`JAVASCRIPT`,kind:`spelling`},AS:{canonicalId:`ASSEMBLYSCRIPT`,kind:`spelling`},PYTHON:{canonicalId:`PYTHON3`,kind:`spelling`},PYPY3:{canonicalId:`PYTHON3`,kind:`implementation`,deprecated:!0,message:`PYPY3 runs the Pyodide implementation; use PYTHON3 instead.`},HS:{canonicalId:`HASKELL`,kind:`spelling`},RB:{canonicalId:`RUBY`,kind:`spelling`},SCHEME:{canonicalId:`LISP`,kind:`compatibility`,message:`SCHEME selects the bundled Puppy Scheme-compatible runtime.`},SCM:{canonicalId:`LISP`,kind:`compatibility`,message:`SCM selects the bundled Puppy Scheme-compatible runtime.`},TS:{canonicalId:`TYPESCRIPT`,kind:`spelling`},MATLAB:{canonicalId:`OCTAVE`,kind:`compatibility`,message:`MATLAB selects GNU Octave compatibility, not MATLAB.`},SQL:{canonicalId:`SQLITE`,kind:`dialect`,message:`SQL selects the SQLite dialect and engine.`},WASM32:{canonicalId:`WASM`,kind:`spelling`}};Object.freeze(Object.keys(A)),Object.freeze(Object.fromEntries(Object.entries(A).map(([e,t])=>[e,Object.freeze({alias:e,deprecated:!1,...t})])));var j=class extends Error{code;path;limit;actual;constructor(e,t,n={}){super(t),this.name=`WorkspaceValidationError`,this.code=e,this.path=n.path,this.limit=n.limit,this.actual=n.actual}};const M=Object.freeze({maxFiles:256,maxFileBytes:2*1024*1024,maxTotalBytes:8*1024*1024,maxPathBytes:1024,caseSensitive:!1});new TextEncoder;const N=/^[a-z][a-z0-9+.-]*:/iu,P=/[\u0000-\u001f\u007f]/u;function F(e){if(typeof e!=`string`||e.length===0||e.startsWith(`/`)||e.startsWith(`\\`)||N.test(e)||P.test(e))throw new j(`invalid-path`,`Invalid workspace path: ${e}`,{path:e});let t=e.replaceAll(`\\`,`/`);if(t.split(`/`).some(e=>e.length===0||e===`.`||e===`..`))throw new j(`invalid-path`,`Invalid workspace path: ${e}`,{path:e});return t}Object.freeze({assetTimeoutMs:6e4,startupTimeoutMs:6e4,compileTimeoutMs:12e4,runTimeoutMs:3e4,maxOutputBytes:1024*1024,maxDiagnostics:1e3,maxWorkspaceBytes:8*1024*1024,maxAssetBytes:128*1024*1024,maxWasmMemoryBytes:512*1024*1024,maxWorkers:1,maxThreads:1}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)?.get,Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,`byteLength`)?.get;const I=Object.freeze({profileId:`ruby-3.4.1-ruby-wasm-2.9.3-2.9.4`,artifactRevision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,rubyVersion:`3.4.1`,rubyRevision:`48d4efcb85000e1ebae42004e963b5d0cedddcf2`,rubyWasmVersion:`2.9.3-2.9.4`,rubyWasmRevision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,wasiSdkVersion:`22.0`,manifestFingerprint:`e8b1ff472882d0580a235bf31715b699fbb70d75d09ad0dc88b19ba7f42d9ed2`,manifestReceipt:Object.freeze({bytes:7832,sha256:`0f0c0cdb2548aebde61e0a2cb9b8d899ce5a4b51b9a21aac9bd96555fc46fe0a`}),moduleJavaScriptReceipt:Object.freeze({bytes:54623,sha256:`d832ed230a34df7db0a7ed823d4fc974fb532b532e0b0de0ad76033acec05b71`}),wasmReceipt:Object.freeze({bytes:9051961,sha256:`4bffd8398d79eed9e5bbe7cd809a88bd3cb861642054a6f3d63b2abfa80f3030`,uncompressedBytes:30608059,uncompressedSha256:`81bc8bbb2130ea34f30826e03d850661bb6cb1c7fe72be598584f12b2810c9de`})});Object.freeze({profile:I});const L=`assets/ruby_stdlib-C40Yu-vu.wasm`;I.manifestFingerprint,Object.freeze({"runtime.mjs":I.moduleJavaScriptReceipt,[L]:Object.freeze({bytes:I.wasmReceipt.uncompressedBytes,sha256:I.wasmReceipt.uncompressedSha256})});const R=L,ie=`${R}.gz.bin`;Object.freeze([Object.freeze({name:`@bjorn3/browser_wasi_shim`,version:`0.4.2`,requestedRange:`^0.4.2`,tarballUrl:`https://registry.npmjs.org/@bjorn3/browser_wasi_shim/-/browser_wasi_shim-0.4.2.tgz`,tarballBytes:31373,tarballSha256:`9c0281520d0e99f027ec7c1c79b4036c0f8168ed9bf98aba19db4737a1333782`,integrity:`sha512-/iHkCVUG3VbcbmEHn5iIUpIrh7a7WPiwZ3sHy4HZKZzBdSadwdddYDZAII2zBvQYV0Lfi8naZngPCN7WPHI/hA==`,attestationUrl:null,repository:`https://github.com/bjorn3/browser_wasi_shim`,revision:`4a55f2a519d0ddfa7e4609c42e0c9769c37c9ae8`,license:`MIT OR Apache-2.0`,files:26,bytes:114555,treeSha256:`4454a5e0d68941440b947fdb705f8aa8fca789c5a3d040902bfe2cda8ffde248`}),Object.freeze({name:`@ruby/3.4-wasm-wasi`,version:`2.9.3-2.9.4`,requestedRange:`2.9.3-2.9.4`,tarballUrl:`https://registry.npmjs.org/@ruby/3.4-wasm-wasi/-/3.4-wasm-wasi-2.9.3-2.9.4.tgz`,tarballBytes:29998123,tarballSha256:`92c1821dd2f03e20d23a3ca86e1d844571722eab88bc168dd659fff1bc987ad4`,integrity:`sha512-Ze2grGTnyT6meSI1j5NHKIpeadecOsMuKAjPFeyU5K85MSeHJWZdNXS7QLF0a0E1kIwQcYHafU10Gz5fPqECsw==`,attestationUrl:`https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2f3.4-wasm-wasi@2.9.3-2.9.4`,repository:`https://github.com/ruby/ruby.wasm`,revision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,license:`MIT`,files:20,bytes:97451582,treeSha256:`b3e9c5a8939d5fe7b7af968ada4f04020846915536f331a4c87f953778ce3778`}),Object.freeze({name:`@ruby/wasm-wasi`,version:`2.9.3-2.9.4`,requestedRange:`2.9.3-2.9.4`,tarballUrl:`https://registry.npmjs.org/@ruby/wasm-wasi/-/wasm-wasi-2.9.3-2.9.4.tgz`,tarballBytes:84917,tarballSha256:`47487299c5be0e32cd6d761b6a11afd63d01b60da8362849fda5e0e007242997`,integrity:`sha512-WxW9wON/TIf+8Ktng8qDJeV/6iH8kw+YwxOsOyXdAdLJgfYDPAXOqpIVd/96y2C9V8VJ2yqZm/IRv6nLeV6EKg==`,attestationUrl:`https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2fwasm-wasi@2.9.3-2.9.4`,repository:`https://github.com/ruby/ruby.wasm`,revision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,license:`MIT`,files:50,bytes:472758,treeSha256:`9971e5cbb59e695715351d31c4c7079de5a678de63de87b814e4ee76b0adddf3`})]),Object.freeze({entry:Object.freeze({path:`scripts/runtime-modules/ruby.ts`,bytes:257,sha256:`501625656ed69b9876ddd6320e08f45bf8e0c236d791ba04458c64f3864d9812`}),script:Object.freeze({path:`scripts/sync-wasm-ruby.mjs`,bytes:46815,sha256:`2805cc5794231142c9ef6f0843b31c64e8169064a106a807f08742e521de6b54`}),tool:Object.freeze({name:`vite`,version:`8.0.8`,requestedRange:`^8.0.8`,tarballUrl:`https://registry.npmjs.org/vite/-/vite-8.0.8.tgz`,integrity:`sha512-dbU7/iLVa8KZALJyLOBOQ88nOXtNG8vxKuOT4I2mD+Ya70KPceF4IAmDsmU0h1Qsn5bPrvsY9HJstCRh3hG6Uw==`,license:`MIT`,files:42,bytes:2185148,treeSha256:`63becb5aef9c86b925810f4298df7c05905aa0ff74e6b8ee3b98991ca6a25a25`}),packageTreeReceiptFormat:`sha256-json-sorted-path-bytes-sha256-v2-excludes-package-manager-bin`}),Object.freeze([Object.freeze({id:`vite-8-es2022-single-module-bundle`,input:`scripts/runtime-modules/ruby.ts`,output:`runtime.mjs`}),Object.freeze({id:`node-zlib-gzip-level-9`,input:R,output:ie})]),Object.freeze([Object.freeze({targetPath:`LICENSE`,mediaType:`text/plain`,spdx:`MIT`,size:1067,sha256:`90357d3794c968704914d42a52354a83f2d8b10cb43df3b63ef1ca0e5bbc0bf2`}),Object.freeze({targetPath:`NOTICE`,mediaType:`text/markdown`,spdx:`LicenseRef-Ruby-Wasm-Third-Party-Notices`,size:51134,sha256:`343c246a6e1f1234e29e51707a54799ea82b50d3a2a41c5221fa12058b2395b2`}),Object.freeze({targetPath:`THIRD_PARTY_NOTICES.md`,mediaType:`text/markdown`,spdx:`LicenseRef-Provenance-Notice`,size:1248,sha256:`e3550c79802a5bf13dc140df11843182131a4b3aac069f0e5824e3cc0378fc68`}),Object.freeze({targetPath:`licenses/browser-wasi-shim/LICENSE-MIT`,mediaType:`text/plain`,spdx:`MIT`,size:1023,sha256:`23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`}),Object.freeze({targetPath:`licenses/browser-wasi-shim/LICENSE-APACHE`,mediaType:`text/plain`,spdx:`Apache-2.0`,size:11357,sha256:`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`})]),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"dyld.mjs":Object.freeze({bytes:82322,sha256:`cc1835b8530f71e29727a71648b635a5cf28f46ed84451f2de17b194d60033d4`}),"rootfs.tar.zst":Object.freeze({bytes:49091550,sha256:`35f68f56fdb72111f150ba05ad31efed2f6fc77ee7026fb4b197ae7901a67adf`}),"bsdtar.wasm":Object.freeze({bytes:1240004,sha256:`e13ebb15ca0971f6629a6313bc043c532dd9be3a0e6bb0b7f8a395de835ad0c0`})}),Object.freeze({"compiler.wasm-runtime.js":Object.freeze({bytes:13936,sha256:`bd103f277be99fd2f3ffc0248b3558e6c2c85a44902bfeef042c6bedcf0b2c63`}),"compiler.wasm":Object.freeze({bytes:4299273,sha256:`9eb047426613c3ed3006838daae49e29929ad0d560ec6b1f8b50e15e2c3865d6`}),"compile-classlib-teavm.bin":Object.freeze({bytes:200621,sha256:`71746dc82ddad5ad8be829f461c235a747bdaf121d1b7abd16dbbbbe6a17f53d`}),"runtime-classlib-teavm.bin":Object.freeze({bytes:2394175,sha256:`f0c9c8c0426e310d08751e57cc88fdfd63ea2f428e4d6cb1b7e59a3dc20844ad`})}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const ae=`emperl.js`,oe=`emperl.wasm`,se=`emperl.data`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"licenses/LICENSE_artistic.txt":`Artistic-1.0-Perl`,"licenses/LICENSE_gpl.txt":`GPL-1.0-or-later`}),Object.freeze({[ae]:`text/javascript`,[oe]:`application/wasm`,[se]:`application/octet-stream`}),Object.freeze({"emperl.js.gz.bin":Object.freeze({logicalPath:ae,encoding:`gzip`}),"emperl.wasm.gz.bin":Object.freeze({logicalPath:oe,encoding:`gzip`}),"emperl.data.gz.bin":Object.freeze({logicalPath:se,encoding:`gzip`})});const z=`janet.js`,B=`janet.wasm`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({[z]:`text/javascript`,[B]:`application/wasm`}),Object.freeze({[z]:Object.freeze({logicalPath:z,encoding:`identity`}),"janet.wasm.gz.bin":Object.freeze({logicalPath:B,encoding:`gzip`})});const ce=Object.freeze([`ENVIRONMENT=worker`,`MODULARIZE=1`,`EXPORT_ES6=1`,`FORCE_FILESYSTEM=1`,`INVOKE_RUN=0`,`EXIT_RUNTIME=1`,`JANET_REDUCED_OS`]);Object.freeze({options:ce,runner:Object.freeze({path:`scripts/runtime-build/wasm-janet-runner.c`,verifiedBuildInput:!1,bytes:1378,sha256:`1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee`})}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"julia.data":`application/octet-stream`,"julia.js":`text/javascript`,"julia.wasm":`application/wasm`}),Object.freeze({"julia.data.gz.bin":Object.freeze({logicalPath:`julia.data`,encoding:`gzip`}),"julia.js.gz.bin":Object.freeze({logicalPath:`julia.js`,encoding:`gzip`}),"julia.wasm.gz.bin":Object.freeze({logicalPath:`julia.wasm`,encoding:`gzip`})}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),Object.freeze({"clang/clang.js":`text/javascript`,"clang/clang.wasm":`application/wasm`,"clang/lld.wasm":`application/wasm`,"clang/memfs.wasm":`application/wasm`,"clang/sysroot.tar":`application/x-tar`,"nim/nim-bundle.js":`text/javascript`,"nim/nim.wasm":`application/wasm`,"nim/nimbase.h":`text/x-c-header`}),Object.freeze({"clang/clang.js.bin":Object.freeze({logicalPath:`clang/clang.js`,encoding:`identity`}),"clang/clang.wasm.gz.bin":Object.freeze({logicalPath:`clang/clang.wasm`,encoding:`gzip`}),"clang/lld.wasm.gz.bin":Object.freeze({logicalPath:`clang/lld.wasm`,encoding:`gzip`}),"clang/memfs.wasm.gz.bin":Object.freeze({logicalPath:`clang/memfs.wasm`,encoding:`gzip`}),"clang/sysroot.tar.gz.bin":Object.freeze({logicalPath:`clang/sysroot.tar`,encoding:`gzip`}),"nim/nim-bundle.js.gz.bin":Object.freeze({logicalPath:`nim/nim-bundle.js`,encoding:`gzip`}),"nim/nim.wasm.gz.bin":Object.freeze({logicalPath:`nim/nim.wasm`,encoding:`gzip`}),"nim/nimbase.h.bin":Object.freeze({logicalPath:`nim/nimbase.h`,encoding:`identity`})}),Object.freeze({"clang/clang.js.bin":`clangJavaScript`,"clang/clang.wasm.gz.bin":`clangWasm`,"clang/lld.wasm.gz.bin":`lldWasm`,"clang/memfs.wasm.gz.bin":`memfsWasm`,"clang/sysroot.tar.gz.bin":`sysroot`,"nim/nim-bundle.js.gz.bin":`nimJavaScript`,"nim/nim.wasm.gz.bin":`nimWasm`,"nim/nimbase.h.bin":`nimbase`}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const le=`sdk/index.mjs`,ue=`sdk/wasmer_js_bg.wasm`,de=`bash.webc`;Object.freeze({[le]:`text/javascript`,[ue]:`application/wasm`,[de]:`application/octet-stream`}),Object.freeze({"sdk/index.mjs.bin":Object.freeze({logicalPath:le,encoding:`identity`}),"sdk/wasmer_js_bg.wasm.gz.bin":Object.freeze({logicalPath:ue,encoding:`gzip`}),"bash.webc.gz.bin":Object.freeze({logicalPath:de,encoding:`gzip`})}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const fe=`compiler.js`,pe=`rtl.js`,me=`system.pas`;Object.freeze({[fe]:`text/javascript`,[pe]:`text/javascript`,[me]:`text/plain`}),Object.freeze({"compiler.js.gz.bin":Object.freeze({logicalPath:fe,encoding:`gzip`}),"rtl.js.bin":Object.freeze({logicalPath:pe,encoding:`identity`}),"system.pas.bin":Object.freeze({logicalPath:me,encoding:`identity`})}),Object.freeze({kind:`opaque-vendored`,repository:`https://github.com/seo-rii/wasm-idle.git`,path:`static/wasm-pascal`,provenance:`legacy-import`,verifiedBuildInput:!1}),Object.freeze({target:`browser`,compiler:`native pas2js`,entrypoint:`runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas`,integrationSources:Object.freeze([`runtimes/wasm-pascal/src/system.pas`,`runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas`,`runtimes/wasm-pascal/src/webfilecache.pp`]),transformations:Object.freeze([`strip trailing horizontal whitespace and normalize final newline`,`gzip compiler.js with Node zlib level 9`]),verifiedBuildInput:!1}),Object.freeze({spdx:`LGPL-2.1-only WITH Independent-modules-exception`,sourceUrl:`https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt`,exceptionSourceUrl:`https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE`,verifiedBuildInput:!1,evidence:`upstream license URLs recorded; texts were not vendored with the legacy generation`}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const V=`require.js`,he=`tcl/wacl-custom.data`,ge=`tcl/wacl-library.data`,_e=`tcl/wacl.js`,ve=`tcl/wacl.wasm`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"licenses/REQUIREJS.txt":`MIT`,"licenses/TCL.txt":`TCL`,"licenses/WACL.txt":`BSD-3-Clause`}),Object.freeze({[V]:`text/javascript`,[he]:`application/octet-stream`,[ge]:`application/octet-stream`,[_e]:`text/javascript`,[ve]:`application/wasm`}),Object.freeze({[V]:Object.freeze({logicalPath:V,encoding:`identity`}),"tcl/wacl-custom.data.bin":Object.freeze({logicalPath:he,encoding:`identity`}),"tcl/wacl-library.data.gz.bin":Object.freeze({logicalPath:ge,encoding:`gzip`}),[_e]:Object.freeze({logicalPath:_e,encoding:`identity`}),"tcl/wacl.wasm.gz.bin":Object.freeze({logicalPath:ve,encoding:`gzip`})}),new TextDecoder(`utf-8`,{fatal:!0});const ye=Object.freeze({"index.js":Object.freeze({mediaType:`text/javascript`,role:`runtime`}),"puppyc.core.wasm":Object.freeze({mediaType:`application/wasm`,role:`runtime`}),"puppyc.core2.wasm":Object.freeze({mediaType:`application/wasm`,role:`runtime`}),"puppyc.js":Object.freeze({mediaType:`text/javascript`,role:`runtime`})}),be=Object.freeze(Object.keys(ye).sort());Object.freeze(be.filter(e=>ye[e].role===`runtime`)),[`artifact`,`assets`,`components`,`fingerprint`,`format`,`license`,`licenseExpression`,`metadata`,`notices`,`profileId`,`provenanceLevel`,`runtime`,`storage`,`transformations`].sort(),[`mediaType`,`path`,`role`,`sha256`,`size`].sort(),[`encoding`,`logicalPath`,`path`,`sha256`,`size`].sort(),[`path`,`sha256`,`size`,`spdx`].sort(),[`mediaType`,`path`,`sha256`,`size`].sort(),new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({wasmMemoryBytes:0,nestedWorkers:0,threads:0}),new TextEncoder;const xe=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP
#define WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP

#include <cstddef>

namespace __gnu_pbds {

struct null_type {};
struct rb_tree_tag {};
struct splay_tree_tag {};
struct ov_tree_tag {};

template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn, typename Allocator>
class null_node_update {
public:
	typedef Node_CItr node_const_iterator;
	typedef Node_Itr node_iterator;
	typedef Cmp_Fn cmp_fn;
	typedef Allocator allocator_type;
};

template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn, typename Allocator>
class tree_order_statistics_node_update {
public:
	typedef Node_CItr node_const_iterator;
	typedef Node_Itr node_iterator;
	typedef Cmp_Fn cmp_fn;
	typedef Allocator allocator_type;
};

} // namespace __gnu_pbds

#endif
`,Se=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP
#define WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP

#include <algorithm>
#include <cstddef>
#include <functional>
#include <iterator>
#include <map>
#include <memory>
#include <set>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <ext/pb_ds/tree_policy.hpp>

namespace __gnu_pbds {

namespace detail {

template <typename Allocator, typename Value>
struct rebind_allocator {
	typedef typename std::allocator_traits<Allocator>::template rebind_alloc<Value> type;
};

template <typename Iterator>
Iterator advance_to_order(Iterator first, Iterator last, std::size_t order) {
	if (order >= static_cast<std::size_t>(std::distance(first, last))) return last;
	std::advance(
		first,
		static_cast<typename std::iterator_traits<Iterator>::difference_type>(order)
	);
	return first;
}

template <
	typename Key,
	typename Mapped,
	typename Hash_Fn,
	typename Eq_Fn,
	typename Allocator
>
struct hash_table_selector {
	typedef std::pair<const Key, Mapped> value_type;
	typedef typename rebind_allocator<Allocator, value_type>::type allocator_type;
	typedef std::unordered_map<Key, Mapped, Hash_Fn, Eq_Fn, allocator_type> type;
};

template <typename Key, typename Hash_Fn, typename Eq_Fn, typename Allocator>
struct hash_table_selector<Key, null_type, Hash_Fn, Eq_Fn, Allocator> {
	typedef typename rebind_allocator<Allocator, Key>::type allocator_type;
	typedef std::unordered_set<Key, Hash_Fn, Eq_Fn, allocator_type> type;
};

} // namespace detail

template <
	typename Key,
	typename Mapped,
	typename Cmp_Fn = std::less<Key>,
	typename Tag = rb_tree_tag,
	template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn_, typename Allocator_>
	class Node_Update = null_node_update,
	typename Allocator = std::allocator<char>
>
class tree {
public:
	typedef Key key_type;
	typedef Mapped mapped_type;
	typedef std::pair<const Key, Mapped> value_type;
	typedef Cmp_Fn cmp_fn;
	typedef Tag container_category;
	typedef Allocator allocator_type;
	typedef std::size_t size_type;

private:
	typedef typename detail::rebind_allocator<Allocator, value_type>::type value_allocator_type;
	typedef std::map<Key, Mapped, Cmp_Fn, value_allocator_type> container_type;

public:
	typedef typename container_type::iterator iterator;
	typedef typename container_type::const_iterator const_iterator;
	typedef typename container_type::iterator point_iterator;
	typedef typename container_type::const_iterator const_point_iterator;
	typedef typename container_type::reverse_iterator reverse_iterator;
	typedef typename container_type::const_reverse_iterator const_reverse_iterator;

	tree() = default;
	explicit tree(const Cmp_Fn& compare) : values_(compare) {}

	template <typename InputIt>
	tree(InputIt first, InputIt last) : values_(first, last) {}

	bool empty() const { return values_.empty(); }
	size_type size() const { return values_.size(); }
	size_type max_size() const { return values_.max_size(); }

	iterator begin() { return values_.begin(); }
	const_iterator begin() const { return values_.begin(); }
	const_iterator cbegin() const { return values_.cbegin(); }
	iterator end() { return values_.end(); }
	const_iterator end() const { return values_.end(); }
	const_iterator cend() const { return values_.cend(); }
	reverse_iterator rbegin() { return values_.rbegin(); }
	const_reverse_iterator rbegin() const { return values_.rbegin(); }
	reverse_iterator rend() { return values_.rend(); }
	const_reverse_iterator rend() const { return values_.rend(); }

	std::pair<iterator, bool> insert(const value_type& value) { return values_.insert(value); }
	std::pair<iterator, bool> insert(value_type&& value) { return values_.insert(std::move(value)); }

	template <typename InputIt>
	void insert(InputIt first, InputIt last) {
		values_.insert(first, last);
	}

	mapped_type& operator[](const key_type& key) { return values_[key]; }
	mapped_type& at(const key_type& key) { return values_.at(key); }
	const mapped_type& at(const key_type& key) const { return values_.at(key); }

	iterator find(const key_type& key) { return values_.find(key); }
	const_iterator find(const key_type& key) const { return values_.find(key); }
	bool contains(const key_type& key) const { return values_.find(key) != values_.end(); }
	size_type count(const key_type& key) const { return values_.count(key); }

	iterator lower_bound(const key_type& key) { return values_.lower_bound(key); }
	const_iterator lower_bound(const key_type& key) const { return values_.lower_bound(key); }
	iterator upper_bound(const key_type& key) { return values_.upper_bound(key); }
	const_iterator upper_bound(const key_type& key) const { return values_.upper_bound(key); }

	size_type erase(const key_type& key) { return values_.erase(key); }
	iterator erase(const_iterator position) { return values_.erase(position); }
	iterator erase(const_iterator first, const_iterator last) { return values_.erase(first, last); }
	void clear() { values_.clear(); }
	void swap(tree& other) { values_.swap(other.values_); }

	iterator find_by_order(size_type order) {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	const_iterator find_by_order(size_type order) const {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	size_type order_of_key(const key_type& key) const {
		return static_cast<size_type>(std::distance(values_.begin(), values_.lower_bound(key)));
	}

	void join(tree& other) {
		values_.insert(other.values_.begin(), other.values_.end());
		other.values_.clear();
	}

	void split(const key_type& key, tree& other) {
		iterator first = values_.upper_bound(key);
		other.values_.insert(first, values_.end());
		values_.erase(first, values_.end());
	}

private:
	container_type values_;
};

template <
	typename Key,
	typename Cmp_Fn,
	typename Tag,
	template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn_, typename Allocator_>
	class Node_Update,
	typename Allocator
>
class tree<Key, null_type, Cmp_Fn, Tag, Node_Update, Allocator> {
public:
	typedef Key key_type;
	typedef null_type mapped_type;
	typedef Key value_type;
	typedef Cmp_Fn cmp_fn;
	typedef Tag container_category;
	typedef Allocator allocator_type;
	typedef std::size_t size_type;

private:
	typedef typename detail::rebind_allocator<Allocator, value_type>::type value_allocator_type;
	typedef std::set<Key, Cmp_Fn, value_allocator_type> container_type;

public:
	typedef typename container_type::iterator iterator;
	typedef typename container_type::const_iterator const_iterator;
	typedef typename container_type::iterator point_iterator;
	typedef typename container_type::const_iterator const_point_iterator;
	typedef typename container_type::reverse_iterator reverse_iterator;
	typedef typename container_type::const_reverse_iterator const_reverse_iterator;

	tree() = default;
	explicit tree(const Cmp_Fn& compare) : values_(compare) {}

	template <typename InputIt>
	tree(InputIt first, InputIt last) : values_(first, last) {}

	bool empty() const { return values_.empty(); }
	size_type size() const { return values_.size(); }
	size_type max_size() const { return values_.max_size(); }

	iterator begin() { return values_.begin(); }
	const_iterator begin() const { return values_.begin(); }
	const_iterator cbegin() const { return values_.cbegin(); }
	iterator end() { return values_.end(); }
	const_iterator end() const { return values_.end(); }
	const_iterator cend() const { return values_.cend(); }
	reverse_iterator rbegin() { return values_.rbegin(); }
	const_reverse_iterator rbegin() const { return values_.rbegin(); }
	reverse_iterator rend() { return values_.rend(); }
	const_reverse_iterator rend() const { return values_.rend(); }

	std::pair<iterator, bool> insert(const value_type& value) { return values_.insert(value); }
	std::pair<iterator, bool> insert(value_type&& value) { return values_.insert(std::move(value)); }

	template <typename InputIt>
	void insert(InputIt first, InputIt last) {
		values_.insert(first, last);
	}

	iterator find(const key_type& key) { return values_.find(key); }
	const_iterator find(const key_type& key) const { return values_.find(key); }
	bool contains(const key_type& key) const { return values_.find(key) != values_.end(); }
	size_type count(const key_type& key) const { return values_.count(key); }

	iterator lower_bound(const key_type& key) { return values_.lower_bound(key); }
	const_iterator lower_bound(const key_type& key) const { return values_.lower_bound(key); }
	iterator upper_bound(const key_type& key) { return values_.upper_bound(key); }
	const_iterator upper_bound(const key_type& key) const { return values_.upper_bound(key); }

	size_type erase(const key_type& key) { return values_.erase(key); }
	iterator erase(const_iterator position) { return values_.erase(position); }
	iterator erase(const_iterator first, const_iterator last) { return values_.erase(first, last); }
	void clear() { values_.clear(); }
	void swap(tree& other) { values_.swap(other.values_); }

	iterator find_by_order(size_type order) {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	const_iterator find_by_order(size_type order) const {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	size_type order_of_key(const key_type& key) const {
		return static_cast<size_type>(std::distance(values_.begin(), values_.lower_bound(key)));
	}

	void join(tree& other) {
		values_.insert(other.values_.begin(), other.values_.end());
		other.values_.clear();
	}

	void split(const key_type& key, tree& other) {
		iterator first = values_.upper_bound(key);
		other.values_.insert(first, values_.end());
		values_.erase(first, values_.end());
	}

private:
	container_type values_;
};

template <
	typename Key,
	typename Mapped,
	typename Hash_Fn = std::hash<Key>,
	typename Eq_Fn = std::equal_to<Key>,
	typename Comb_Hash_Fn = void,
	typename Resize_Policy = void,
	bool Store_Hash = false,
	typename Allocator = std::allocator<char>
>
using gp_hash_table = typename detail::hash_table_selector<
	Key,
	Mapped,
	Hash_Fn,
	Eq_Fn,
	Allocator
>::type;

template <
	typename Key,
	typename Mapped,
	typename Hash_Fn = std::hash<Key>,
	typename Eq_Fn = std::equal_to<Key>,
	typename Comb_Hash_Fn = void,
	typename Resize_Policy = void,
	bool Store_Hash = false,
	typename Allocator = std::allocator<char>
>
using cc_hash_table = typename detail::hash_table_selector<
	Key,
	Mapped,
	Hash_Fn,
	Eq_Fn,
	Allocator
>::type;

} // namespace __gnu_pbds

#endif
`,Ce=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP
#define WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP

#include <cstddef>

namespace __gnu_pbds {

template <typename Size_Type = std::size_t>
class direct_mask_range_hashing {
public:
	typedef Size_Type size_type;
};

template <typename Size_Type = std::size_t>
class direct_mod_range_hashing {
public:
	typedef Size_Type size_type;
};

template <typename Size_Type = std::size_t>
class linear_probe_fn {
public:
	typedef Size_Type size_type;
};

template <typename Size_Type = std::size_t>
class quadratic_probe_fn {
public:
	typedef Size_Type size_type;
};

class hash_exponential_size_policy {};
class hash_prime_size_policy {};

template <bool External_Load_Access = false, typename Size_Type = std::size_t>
class hash_load_check_resize_trigger {
public:
	typedef Size_Type size_type;
	explicit hash_load_check_resize_trigger(float = 0.125, float = 0.5) {}
};

template <bool External_Load_Access = false, typename Size_Type = std::size_t>
class cc_hash_max_collision_check_resize_trigger {
public:
	typedef Size_Type size_type;
	explicit cc_hash_max_collision_check_resize_trigger(float = 0.5) {}
};

template <
	typename Size_Policy = hash_exponential_size_policy,
	typename Trigger_Policy = hash_load_check_resize_trigger<>,
	bool External_Size_Access = false,
	typename Size_Type = std::size_t
>
class hash_standard_resize_policy {
public:
	typedef Size_Type size_type;
	hash_standard_resize_policy() = default;
	explicit hash_standard_resize_policy(const Size_Policy&) {}
	hash_standard_resize_policy(const Size_Policy&, const Trigger_Policy&) {}
};

} // namespace __gnu_pbds

#endif
`,we=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP
#define WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP

#include <algorithm>
#include <cstddef>
#include <functional>
#include <memory>
#include <queue>
#include <utility>
#include <vector>

namespace __gnu_pbds {

struct pairing_heap_tag {};
struct binary_heap_tag {};
struct binomial_heap_tag {};
struct rc_binomial_heap_tag {};
struct thin_heap_tag {};

namespace detail {

template <typename Allocator, typename Value>
struct priority_queue_rebind_allocator {
	typedef typename std::allocator_traits<Allocator>::template rebind_alloc<Value> type;
};

} // namespace detail

template <
	typename Value_Type,
	typename Cmp_Fn = std::less<Value_Type>,
	typename Tag = pairing_heap_tag,
	typename Allocator = std::allocator<char>
>
class priority_queue {
public:
	typedef Value_Type value_type;
	typedef Cmp_Fn cmp_fn;
	typedef Tag container_category;
	typedef Allocator allocator_type;
	typedef std::size_t size_type;
	typedef value_type& reference;
	typedef const value_type& const_reference;

private:
	typedef typename detail::priority_queue_rebind_allocator<Allocator, value_type>::type value_allocator_type;
	typedef std::vector<value_type, value_allocator_type> container_type;

public:
	typedef typename container_type::iterator point_iterator;
	typedef typename container_type::const_iterator const_point_iterator;

	priority_queue() : values_(), compare_() {
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	explicit priority_queue(const Cmp_Fn& compare) : values_(), compare_(compare) {
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	template <typename InputIt>
	priority_queue(InputIt first, InputIt last) : values_(first, last), compare_() {
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	bool empty() const { return values_.empty(); }
	size_type size() const { return values_.size(); }
	const_reference top() const { return values_.front(); }
	void clear() { values_.clear(); }
	void swap(priority_queue& other) {
		values_.swap(other.values_);
		std::swap(compare_, other.compare_);
	}

	point_iterator push(const_reference value) {
		values_.push_back(value);
		std::push_heap(values_.begin(), values_.end(), compare_);
		return values_.empty() ? values_.end() : values_.begin();
	}

	void pop() {
		std::pop_heap(values_.begin(), values_.end(), compare_);
		values_.pop_back();
	}

	void modify(point_iterator position, const_reference value) {
		if (position == values_.end()) return;
		*position = value;
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	void erase(point_iterator position) {
		if (position == values_.end()) return;
		values_.erase(position);
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	void join(priority_queue& other) {
		values_.insert(values_.end(), other.values_.begin(), other.values_.end());
		other.values_.clear();
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

private:
	container_type values_;
	Cmp_Fn compare_;
};

} // namespace __gnu_pbds

#endif
`,Te=String.raw`#ifndef WASM_CLANG_EXT_ROPE
#define WASM_CLANG_EXT_ROPE

#include <algorithm>
#include <cstddef>
#include <iosfwd>
#include <iterator>
#include <memory>
#include <ostream>
#include <string>
#include <utility>

namespace __gnu_cxx {

template <typename CharT, typename Alloc = std::allocator<CharT>>
class rope {
public:
	typedef CharT value_type;
	typedef Alloc allocator_type;
	typedef std::basic_string<CharT, std::char_traits<CharT>, Alloc> string_type;
	typedef typename string_type::traits_type traits_type;
	typedef typename string_type::size_type size_type;
	typedef typename string_type::difference_type difference_type;
	typedef typename string_type::reference reference;
	typedef typename string_type::const_reference const_reference;
	typedef typename string_type::iterator iterator;
	typedef typename string_type::const_iterator const_iterator;

	static const size_type npos = string_type::npos;

	rope() = default;
	rope(const rope&) = default;
	rope(rope&&) = default;
	rope& operator=(const rope&) = default;
	rope& operator=(rope&&) = default;

	rope(const CharT* value) : data_(value ? value : empty_c_str()) {}
	rope(const CharT* value, size_type count) : data_(value, count) {}
	rope(size_type count, CharT value) : data_(count, value) {}
	rope(const string_type& value) : data_(value) {}
	rope(string_type&& value) : data_(std::move(value)) {}

	template <typename InputIt>
	rope(InputIt first, InputIt last) : data_(first, last) {}

	bool empty() const { return data_.empty(); }
	size_type size() const { return data_.size(); }
	size_type length() const { return data_.length(); }
	size_type max_size() const { return data_.max_size(); }
	void clear() { data_.clear(); }

	const CharT* c_str() const { return data_.c_str(); }
	const string_type& str() const { return data_; }

	iterator begin() { return data_.begin(); }
	const_iterator begin() const { return data_.begin(); }
	const_iterator cbegin() const { return data_.cbegin(); }
	iterator end() { return data_.end(); }
	const_iterator end() const { return data_.end(); }
	const_iterator cend() const { return data_.cend(); }

	reference operator[](size_type index) { return data_[index]; }
	const_reference operator[](size_type index) const { return data_[index]; }
	reference at(size_type index) { return data_.at(index); }
	const_reference at(size_type index) const { return data_.at(index); }
	reference mutable_reference_at(size_type index) { return data_.at(index); }

	void push_back(CharT value) { data_.push_back(value); }
	void pop_back() { data_.pop_back(); }

	rope& append(const rope& value) {
		data_.append(value.data_);
		return *this;
	}

	rope& append(const CharT* value) {
		data_.append(value ? value : empty_c_str());
		return *this;
	}

	rope& append(const CharT* value, size_type count) {
		data_.append(value, count);
		return *this;
	}

	rope& append(size_type count, CharT value) {
		data_.append(count, value);
		return *this;
	}

	rope& insert(size_type position, const rope& value) {
		data_.insert(position, value.data_);
		return *this;
	}

	rope& insert(size_type position, const CharT* value) {
		data_.insert(position, value ? value : empty_c_str());
		return *this;
	}

	rope& insert(size_type position, const CharT* value, size_type count) {
		data_.insert(position, value, count);
		return *this;
	}

	rope& insert(size_type position, size_type count, CharT value) {
		data_.insert(position, count, value);
		return *this;
	}

	rope& erase(size_type position = 0, size_type count = npos) {
		data_.erase(position, count);
		return *this;
	}

	rope& replace(size_type position, size_type count, const rope& value) {
		data_.replace(position, count, value.data_);
		return *this;
	}

	rope& replace(size_type position, size_type count, const CharT* value) {
		data_.replace(position, count, value ? value : empty_c_str());
		return *this;
	}

	rope substr(size_type position = 0, size_type count = npos) const {
		return rope(data_.substr(position, count));
	}

	size_type copy(size_type position, size_type count, CharT* target) const {
		if (position > data_.size()) return 0;
		const size_type copied = std::min(count, data_.size() - position);
		traits_type::copy(target, data_.data() + position, copied);
		return copied;
	}

	int compare(const rope& value) const { return data_.compare(value.data_); }

	rope& operator+=(const rope& value) { return append(value); }
	rope& operator+=(const CharT* value) { return append(value); }
	rope& operator+=(CharT value) {
		push_back(value);
		return *this;
	}

private:
	static const CharT* empty_c_str() {
		static const CharT empty[1] = {};
		return empty;
	}

	string_type data_;
};

template <typename CharT, typename Alloc>
rope<CharT, Alloc> operator+(rope<CharT, Alloc> left, const rope<CharT, Alloc>& right) {
	left += right;
	return left;
}

template <typename CharT, typename Alloc>
bool operator==(const rope<CharT, Alloc>& left, const rope<CharT, Alloc>& right) {
	return left.compare(right) == 0;
}

template <typename CharT, typename Alloc>
bool operator!=(const rope<CharT, Alloc>& left, const rope<CharT, Alloc>& right) {
	return !(left == right);
}

template <typename CharT, typename Alloc>
bool operator<(const rope<CharT, Alloc>& left, const rope<CharT, Alloc>& right) {
	return left.compare(right) < 0;
}

template <typename CharT, typename Alloc>
std::basic_ostream<CharT>& operator<<(
	std::basic_ostream<CharT>& output,
	const rope<CharT, Alloc>& value
) {
	return output << value.str();
}

typedef rope<char> crope;
typedef rope<wchar_t> wrope;

} // namespace __gnu_cxx

#endif
`,H=String.raw`#ifndef WASM_CLANG_SETJMP_H
#define WASM_CLANG_SETJMP_H

#ifdef __cplusplus
extern "C" {
#endif

typedef long jmp_buf[32];
int setjmp(jmp_buf);
__attribute__((noreturn)) void longjmp(jmp_buf, int);

#ifdef __cplusplus
}
#endif

#endif
`,Ee=String.raw`#ifndef WASM_CLANG_BITS_STDCPP_H
#define WASM_CLANG_BITS_STDCPP_H

#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <cctype>
#include <cerrno>
#include <cfloat>
#include <climits>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#endif
`,De=String.raw`#ifndef WASM_CLANG_BITS_EXTCXX_H
#define WASM_CLANG_BITS_EXTCXX_H

#include <bits/stdc++.h>
#include <ext/hash_map>
#include <ext/hash_set>
#include <ext/rope>
#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/hash_policy.hpp>
#include <ext/pb_ds/priority_queue.hpp>
#include <ext/pb_ds/tree_policy.hpp>

#endif
`,U=[{path:`include/setjmp.h`,contents:H},{path:`include/bits/stdc++.h`,contents:Ee},{path:`include/bits/extc++.h`,contents:De},{path:`include/c++/v1/ext/rope`,contents:Te},{path:`include/c++/v1/ext/pb_ds/tree_policy.hpp`,contents:xe},{path:`include/c++/v1/ext/pb_ds/assoc_container.hpp`,contents:Se},{path:`include/c++/v1/ext/pb_ds/hash_policy.hpp`,contents:Ce},{path:`include/c++/v1/ext/pb_ds/priority_queue.hpp`,contents:we}],Oe=[`include/c++/v1/ext/pb_ds`,`include/bits`],W=(e,t)=>{let n=e.replace(/\/+$/,``),r=t.replace(/^\/+/,``);return n?`${n}/${r}`:r};function ke(e,t=``){for(let n of Oe)e.mkdirTree(W(t,n));for(let n of U)e.writeFile(W(t,n.path),n.contents)}var G=class{inJson=!1;rawText=[];unbalancedBraces=0;inString=!1;inEscape=0;textDecoder=new TextDecoder;insert(e){if(!this.inJson&&e===123&&(this.inJson=!0,this.rawText=[]),!this.inJson)return null;if(this.rawText.push(e),this.inString)this.inEscape?(e===75&&(this.inEscape+=4),--this.inEscape):e===92?this.inEscape=1:e===34&&(this.inString=!1);else if(e===123)this.unbalancedBraces+=1;else if(e===125){if(--this.unbalancedBraces,this.unbalancedBraces===0)return this.inJson=!1,this.textDecoder.decode(new Uint8Array(this.rawText))}else e===34&&(this.inString=!0);return null}};const K=e=>e.byteLength>=2&&e[0]===31&&e[1]===139;async function Ae(e,t,n,r){let i=e.getReader(),a=r,o=!1;if(a?.aborted){o=!0;let e=q(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}try{i.releaseLock()}catch{}throw e}let s,c=a?new Promise((e,t)=>{s=()=>{if(o)return;o=!0;let e=q(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}t(e)},a.addEventListener(`abort`,s,{once:!0})}):void 0,l=new Uint8Array(Math.min(65536,n)),u=0,d=!1,f,p;try{for(J(a);;){let e=i.read(),{done:r,value:o}=c?await Promise.race([e,c]):await e;if(J(a),r)break;if(!o)continue;let s=u+o.byteLength;if(s>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);if(s>l.byteLength){let e=Math.min(n,Math.max(s,Math.max(l.byteLength*2,1))),t=new Uint8Array(e);t.set(l.subarray(0,u)),l=t}l.set(o,u),u=s}J(a),f=l.subarray(0,u),d=!0}catch(e){if(a?.aborted)throw q(a);if(!o){o=!0;try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}}throw e}finally{s&&a?.removeEventListener(`abort`,s);try{i.releaseLock()}catch(e){d&&(p={error:e})}}if(p)throw p.error;return f}function q(e){return e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`)}function J(e){if(e?.aborted)throw q(e)}async function je(e,t=`runtime asset`,n=134217728,r){if(!Number.isSafeInteger(n)||n<0)throw Error(`Runtime asset decompression limit must be a non-negative safe integer`);if(J(r),!K(e)){if(e.byteLength>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);return e}if(typeof DecompressionStream!=`function`)throw Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);try{let i=Uint8Array.from(e),a=new ReadableStream({start(e){e.enqueue(i),e.close()}}),o=new DecompressionStream(`gzip`);return await Ae(a.pipeThrough({readable:o.readable,writable:o.writable}),t,n,r)}catch(e){throw r?.aborted?q(r):Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}const Me=Object.freeze({"builtins.h":`/*===---- builtins.h - Standard header for extra builtins -----------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

/// Some legacy compilers have builtin definitions in a file named builtins.h.
/// This header file has been added to allow compatibility with code that was
/// written for those compilers. Code may have an include line for this file
/// and to avoid an error an empty file with this name is provided.
#ifndef __BUILTINS_H
#define __BUILTINS_H

#if defined(__MVS__) && __has_include_next(<builtins.h>)
#include_next <builtins.h>
#endif /* __MVS__ */
#endif /* __BUILTINS_H */
`,"float.h":`/*===---- float.h - Characteristics of floating point types ----------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#if defined(__MVS__) && __has_include_next(<float.h>)
#include <__float_header_macro.h>
#include_next <float.h>
#else

#if !defined(__need_infinity_nan)
#define __need_float_float
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
#define __need_infinity_nan
#endif
#include <__float_header_macro.h>
#endif

#ifdef __need_float_float
/* If we're on MinGW, fall back to the system's float.h, which might have
 * additional definitions provided for Windows.
 * For more details see http://msdn.microsoft.com/en-us/library/y0ybw9fy.aspx
 *
 * Also fall back on AIX to allow additional definitions and
 * implementation-defined values.
 */
#if (defined(__MINGW32__) || defined(_MSC_VER) || defined(_AIX)) &&            \\
    __STDC_HOSTED__ && __has_include_next(<float.h>)

#  include_next <float.h>

#endif

#include <__float_float.h>
#undef __need_float_float
#endif

#ifdef __need_infinity_nan
#include <__float_infinity_nan.h>
#undef __need_infinity_nan
#endif

#endif /* __MVS__ */
`,"__float_float.h":`/*===---- __float_float.h --------------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_FLOAT_FLOAT_H
#define __CLANG_FLOAT_FLOAT_H

#if (defined(__MINGW32__) || defined(_MSC_VER) || defined(_AIX)) &&            \\
    __STDC_HOSTED__

/* Undefine anything that we'll be redefining below. */
#  undef FLT_EVAL_METHOD
#  undef FLT_ROUNDS
#  undef FLT_RADIX
#  undef FLT_MANT_DIG
#  undef DBL_MANT_DIG
#  undef LDBL_MANT_DIG
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201103L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#    undef DECIMAL_DIG
#  endif
#  undef FLT_DIG
#  undef DBL_DIG
#  undef LDBL_DIG
#  undef FLT_MIN_EXP
#  undef DBL_MIN_EXP
#  undef LDBL_MIN_EXP
#  undef FLT_MIN_10_EXP
#  undef DBL_MIN_10_EXP
#  undef LDBL_MIN_10_EXP
#  undef FLT_MAX_EXP
#  undef DBL_MAX_EXP
#  undef LDBL_MAX_EXP
#  undef FLT_MAX_10_EXP
#  undef DBL_MAX_10_EXP
#  undef LDBL_MAX_10_EXP
#  undef FLT_MAX
#  undef DBL_MAX
#  undef LDBL_MAX
#  undef FLT_EPSILON
#  undef DBL_EPSILON
#  undef LDBL_EPSILON
#  undef FLT_MIN
#  undef DBL_MIN
#  undef LDBL_MIN
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201703L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#    undef FLT_TRUE_MIN
#    undef DBL_TRUE_MIN
#    undef LDBL_TRUE_MIN
#    undef FLT_DECIMAL_DIG
#    undef DBL_DECIMAL_DIG
#    undef LDBL_DECIMAL_DIG
#    undef FLT_HAS_SUBNORM
#    undef DBL_HAS_SUBNORM
#    undef LDBL_HAS_SUBNORM
#  endif
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
#    undef FLT_NORM_MAX
#    undef DBL_NORM_MAX
#    undef LDBL_NORM_MAX
#endif
#endif

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
#  undef FLT_SNAN
#  undef DBL_SNAN
#  undef LDBL_SNAN
#endif

/* Characteristics of floating point types, C99 5.2.4.2.2 */

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L)
#define FLT_EVAL_METHOD __FLT_EVAL_METHOD__
#endif
#define FLT_ROUNDS (__builtin_flt_rounds())
#define FLT_RADIX __FLT_RADIX__

#define FLT_MANT_DIG __FLT_MANT_DIG__
#define DBL_MANT_DIG __DBL_MANT_DIG__
#define LDBL_MANT_DIG __LDBL_MANT_DIG__

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201103L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#  define DECIMAL_DIG __DECIMAL_DIG__
#endif

#define FLT_DIG __FLT_DIG__
#define DBL_DIG __DBL_DIG__
#define LDBL_DIG __LDBL_DIG__

#define FLT_MIN_EXP __FLT_MIN_EXP__
#define DBL_MIN_EXP __DBL_MIN_EXP__
#define LDBL_MIN_EXP __LDBL_MIN_EXP__

#define FLT_MIN_10_EXP __FLT_MIN_10_EXP__
#define DBL_MIN_10_EXP __DBL_MIN_10_EXP__
#define LDBL_MIN_10_EXP __LDBL_MIN_10_EXP__

#define FLT_MAX_EXP __FLT_MAX_EXP__
#define DBL_MAX_EXP __DBL_MAX_EXP__
#define LDBL_MAX_EXP __LDBL_MAX_EXP__

#define FLT_MAX_10_EXP __FLT_MAX_10_EXP__
#define DBL_MAX_10_EXP __DBL_MAX_10_EXP__
#define LDBL_MAX_10_EXP __LDBL_MAX_10_EXP__

#define FLT_MAX __FLT_MAX__
#define DBL_MAX __DBL_MAX__
#define LDBL_MAX __LDBL_MAX__

#define FLT_EPSILON __FLT_EPSILON__
#define DBL_EPSILON __DBL_EPSILON__
#define LDBL_EPSILON __LDBL_EPSILON__

#define FLT_MIN __FLT_MIN__
#define DBL_MIN __DBL_MIN__
#define LDBL_MIN __LDBL_MIN__

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201703L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#  define FLT_TRUE_MIN __FLT_DENORM_MIN__
#  define DBL_TRUE_MIN __DBL_DENORM_MIN__
#  define LDBL_TRUE_MIN __LDBL_DENORM_MIN__
#  define FLT_DECIMAL_DIG __FLT_DECIMAL_DIG__
#  define DBL_DECIMAL_DIG __DBL_DECIMAL_DIG__
#  define LDBL_DECIMAL_DIG __LDBL_DECIMAL_DIG__
#  define FLT_HAS_SUBNORM __FLT_HAS_DENORM__
#  define DBL_HAS_SUBNORM __DBL_HAS_DENORM__
#  define LDBL_HAS_SUBNORM __LDBL_HAS_DENORM__
#endif

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
   /* C23 5.2.5.3.2p28 */
#  define FLT_SNAN (__builtin_nansf(""))
#  define DBL_SNAN (__builtin_nans(""))
#  define LDBL_SNAN (__builtin_nansl(""))

   /* C23 5.2.5.3.3p32 */
#  define FLT_NORM_MAX __FLT_NORM_MAX__
#  define DBL_NORM_MAX __DBL_NORM_MAX__
#  define LDBL_NORM_MAX __LDBL_NORM_MAX__
#endif

#ifdef __STDC_WANT_IEC_60559_TYPES_EXT__
#  define FLT16_MANT_DIG    __FLT16_MANT_DIG__
#  define FLT16_DECIMAL_DIG __FLT16_DECIMAL_DIG__
#  define FLT16_DIG         __FLT16_DIG__
#  define FLT16_MIN_EXP     __FLT16_MIN_EXP__
#  define FLT16_MIN_10_EXP  __FLT16_MIN_10_EXP__
#  define FLT16_MAX_EXP     __FLT16_MAX_EXP__
#  define FLT16_MAX_10_EXP  __FLT16_MAX_10_EXP__
#  define FLT16_MAX         __FLT16_MAX__
#  define FLT16_EPSILON     __FLT16_EPSILON__
#  define FLT16_MIN         __FLT16_MIN__
#  define FLT16_TRUE_MIN    __FLT16_TRUE_MIN__
#endif /* __STDC_WANT_IEC_60559_TYPES_EXT__ */

#endif /* __CLANG_FLOAT_FLOAT_H */
`,"__float_header_macro.h":`/*===---- __float_header_macro.h -------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_FLOAT_H
#define __CLANG_FLOAT_H
#endif /* __CLANG_FLOAT_H */
`,"__float_infinity_nan.h":`/*===---- __float_infinity_nan.h -------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_FLOAT_INFINITY_NAN_H
#define __CLANG_FLOAT_INFINITY_NAN_H

/* C23 5.2.5.3.3p29-30 */
#undef INFINITY
#undef NAN

#define INFINITY (__builtin_inff())
#define NAN (__builtin_nanf(""))

#endif /* __CLANG_FLOAT_INFINITY_NAN_H */
`,"inttypes.h":`/*===---- inttypes.h - Standard header for integer printf macros ----------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_INTTYPES_H
// AIX system headers need inttypes.h to be re-enterable while _STD_TYPES_T
// is defined until an inclusion of it without _STD_TYPES_T occurs, in which
// case the header guard macro is defined.
#if !defined(_AIX) || !defined(_STD_TYPES_T)
#define __CLANG_INTTYPES_H
#endif
#if defined(__MVS__) && __has_include_next(<inttypes.h>)
#include_next <inttypes.h>
#else

#if defined(_MSC_VER) && _MSC_VER < 1800
#error MSVC does not have inttypes.h prior to Visual Studio 2013
#endif

#include_next <inttypes.h>

#if defined(_MSC_VER) && _MSC_VER < 1900
/* MSVC headers define int32_t as int, but PRIx32 as "lx" instead of "x".
 * This triggers format warnings, so fix it up here. */
#undef PRId32
#undef PRIdLEAST32
#undef PRIdFAST32
#undef PRIi32
#undef PRIiLEAST32
#undef PRIiFAST32
#undef PRIo32
#undef PRIoLEAST32
#undef PRIoFAST32
#undef PRIu32
#undef PRIuLEAST32
#undef PRIuFAST32
#undef PRIx32
#undef PRIxLEAST32
#undef PRIxFAST32
#undef PRIX32
#undef PRIXLEAST32
#undef PRIXFAST32

#undef SCNd32
#undef SCNdLEAST32
#undef SCNdFAST32
#undef SCNi32
#undef SCNiLEAST32
#undef SCNiFAST32
#undef SCNo32
#undef SCNoLEAST32
#undef SCNoFAST32
#undef SCNu32
#undef SCNuLEAST32
#undef SCNuFAST32
#undef SCNx32
#undef SCNxLEAST32
#undef SCNxFAST32

#define PRId32 "d"
#define PRIdLEAST32 "d"
#define PRIdFAST32 "d"
#define PRIi32 "i"
#define PRIiLEAST32 "i"
#define PRIiFAST32 "i"
#define PRIo32 "o"
#define PRIoLEAST32 "o"
#define PRIoFAST32 "o"
#define PRIu32 "u"
#define PRIuLEAST32 "u"
#define PRIuFAST32 "u"
#define PRIx32 "x"
#define PRIxLEAST32 "x"
#define PRIxFAST32 "x"
#define PRIX32 "X"
#define PRIXLEAST32 "X"
#define PRIXFAST32 "X"

#define SCNd32 "d"
#define SCNdLEAST32 "d"
#define SCNdFAST32 "d"
#define SCNi32 "i"
#define SCNiLEAST32 "i"
#define SCNiFAST32 "i"
#define SCNo32 "o"
#define SCNoLEAST32 "o"
#define SCNoFAST32 "o"
#define SCNu32 "u"
#define SCNuLEAST32 "u"
#define SCNuFAST32 "u"
#define SCNx32 "x"
#define SCNxLEAST32 "x"
#define SCNxFAST32 "x"
#endif

#endif /* __MVS__ */
#endif /* __CLANG_INTTYPES_H */
`,"iso646.h":`/*===---- iso646.h - Standard header for alternate spellings of operators---===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __ISO646_H
#define __ISO646_H
#if defined(__MVS__) && __has_include_next(<iso646.h>)
#include_next <iso646.h>
#else

#ifndef __cplusplus
#define and    &&
#define and_eq &=
#define bitand &
#define bitor  |
#define compl  ~
#define not    !
#define not_eq !=
#define or     ||
#define or_eq  |=
#define xor    ^
#define xor_eq ^=
#endif

#endif /* __MVS__ */
#endif /* __ISO646_H */
`,"limits.h":`/*===---- limits.h - Standard header for integer sizes --------------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_LIMITS_H
#define __CLANG_LIMITS_H

#if defined(__MVS__) && __has_include_next(<limits.h>)
#include_next <limits.h>
#else

/* The system's limits.h may, in turn, try to #include_next GCC's limits.h.
   Avert this #include_next madness. */
#if defined __GNUC__ && !defined _GCC_LIMITS_H_
#define _GCC_LIMITS_H_
#endif

/* System headers include a number of constants from POSIX in <limits.h>.
   Include it if we're hosted. */
#if __STDC_HOSTED__ && __has_include_next(<limits.h>)
#include_next <limits.h>
#endif

/* Many system headers try to "help us out" by defining these.  No really, we
   know how big each datatype is. */
#undef  SCHAR_MIN
#undef  SCHAR_MAX
#undef  UCHAR_MAX
#undef  SHRT_MIN
#undef  SHRT_MAX
#undef  USHRT_MAX
#undef  INT_MIN
#undef  INT_MAX
#undef  UINT_MAX
#undef  LONG_MIN
#undef  LONG_MAX
#undef  ULONG_MAX

#undef  CHAR_BIT
#undef  CHAR_MIN
#undef  CHAR_MAX

/* C90/99 5.2.4.2.1 */
#define SCHAR_MAX __SCHAR_MAX__
#define SHRT_MAX  __SHRT_MAX__
#define INT_MAX   __INT_MAX__
#define LONG_MAX  __LONG_MAX__

#define SCHAR_MIN (-__SCHAR_MAX__-1)
#define SHRT_MIN  (-__SHRT_MAX__ -1)
#define INT_MIN   (-__INT_MAX__  -1)
#define LONG_MIN  (-__LONG_MAX__ -1L)

#define UCHAR_MAX (__SCHAR_MAX__*2  +1)
#if __SHRT_WIDTH__ < __INT_WIDTH__
#define USHRT_MAX (__SHRT_MAX__ * 2 + 1)
#else
#define USHRT_MAX (__SHRT_MAX__ * 2U + 1U)
#endif
#define UINT_MAX  (__INT_MAX__  *2U +1U)
#define ULONG_MAX (__LONG_MAX__ *2UL+1UL)

#ifndef MB_LEN_MAX
#define MB_LEN_MAX 1
#endif

#define CHAR_BIT  __CHAR_BIT__

/* C23 5.2.4.2.1 */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define BOOL_WIDTH   __BOOL_WIDTH__
#define CHAR_WIDTH   CHAR_BIT
#define SCHAR_WIDTH  CHAR_BIT
#define UCHAR_WIDTH  CHAR_BIT
#define USHRT_WIDTH  __SHRT_WIDTH__
#define SHRT_WIDTH   __SHRT_WIDTH__
#define UINT_WIDTH   __INT_WIDTH__
#define INT_WIDTH    __INT_WIDTH__
#define ULONG_WIDTH  __LONG_WIDTH__
#define LONG_WIDTH   __LONG_WIDTH__
#define ULLONG_WIDTH __LLONG_WIDTH__
#define LLONG_WIDTH  __LLONG_WIDTH__

#define BITINT_MAXWIDTH __BITINT_MAXWIDTH__
#endif

#ifdef __CHAR_UNSIGNED__  /* -funsigned-char */
#define CHAR_MIN 0
#define CHAR_MAX UCHAR_MAX
#else
#define CHAR_MIN SCHAR_MIN
#define CHAR_MAX __SCHAR_MAX__
#endif

/* C99 5.2.4.2.1: Added long long.
   C++11 18.3.3.2: same contents as the Standard C Library header <limits.h>.
 */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L)

#undef  LLONG_MIN
#undef  LLONG_MAX
#undef  ULLONG_MAX

#define LLONG_MAX  __LONG_LONG_MAX__
#define LLONG_MIN  (-__LONG_LONG_MAX__-1LL)
#define ULLONG_MAX (__LONG_LONG_MAX__*2ULL+1ULL)
#endif

/* LONG_LONG_MIN/LONG_LONG_MAX/ULONG_LONG_MAX are a GNU extension. Android's
   bionic also defines them. It's too bad that we don't have something like
   #pragma poison that could be used to deprecate a macro - the code should just
   use LLONG_MAX and friends.
 */
#if (defined(__GNU_LIBRARY__) ? defined(__USE_GNU)                             \\
                              : !defined(__STRICT_ANSI__)) ||                  \\
    defined(__BIONIC__)

#undef   LONG_LONG_MIN
#undef   LONG_LONG_MAX
#undef   ULONG_LONG_MAX

#define LONG_LONG_MAX  __LONG_LONG_MAX__
#define LONG_LONG_MIN  (-__LONG_LONG_MAX__-1LL)
#define ULONG_LONG_MAX (__LONG_LONG_MAX__*2ULL+1ULL)
#endif

#endif /* __MVS__ */
#endif /* __CLANG_LIMITS_H */
`,"stdalign.h":`/*===---- stdalign.h - Standard header for alignment ------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDALIGN_H
#define __STDALIGN_H

#if defined(__cplusplus) ||                                                    \\
    (defined(__STDC_VERSION__) && __STDC_VERSION__ < 202311L)
#ifndef __cplusplus
#define alignas _Alignas
#define alignof _Alignof
#endif

#define __alignas_is_defined 1
#define __alignof_is_defined 1
#endif /* __STDC_VERSION__ */

#endif /* __STDALIGN_H */
`,"stdarg.h":`/*===---- stdarg.h - Variable argument handling ----------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * This header is designed to be included multiple times. If any of the __need_
 * macros are defined, then only that subset of interfaces are provided. This
 * can be useful for POSIX headers that need to not expose all of stdarg.h, but
 * need to use some of its interfaces. Otherwise this header provides all of
 * the expected interfaces.
 *
 * When clang modules are enabled, this header is a textual header to support
 * the multiple include behavior. As such, it doesn't directly declare anything
 * so that it doesn't add duplicate declarations to all of its includers'
 * modules.
 */
#if defined(__MVS__) && __has_include_next(<stdarg.h>)
#undef __need___va_list
#undef __need_va_list
#undef __need_va_arg
#undef __need___va_copy
#undef __need_va_copy
#include <__stdarg_header_macro.h>
#include_next <stdarg.h>

#else
#if !defined(__need___va_list) && !defined(__need_va_list) &&                  \\
    !defined(__need_va_arg) && !defined(__need___va_copy) &&                   \\
    !defined(__need_va_copy)
#define __need___va_list
#define __need_va_list
#define __need_va_arg
#define __need___va_copy
/* GCC always defines __va_copy, but does not define va_copy unless in c99 mode
 * or -ansi is not specified, since it was not part of C90.
 */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L) ||                        \\
    !defined(__STRICT_ANSI__)
#define __need_va_copy
#endif
#include <__stdarg_header_macro.h>
#endif

#ifdef __need___va_list
#include <__stdarg___gnuc_va_list.h>
#undef __need___va_list
#endif /* defined(__need___va_list) */

#ifdef __need_va_list
#include <__stdarg_va_list.h>
#undef __need_va_list
#endif /* defined(__need_va_list) */

#ifdef __need_va_arg
#include <__stdarg_va_arg.h>
#undef __need_va_arg
#endif /* defined(__need_va_arg) */

#ifdef __need___va_copy
#include <__stdarg___va_copy.h>
#undef __need___va_copy
#endif /* defined(__need___va_copy) */

#ifdef __need_va_copy
#include <__stdarg_va_copy.h>
#undef __need_va_copy
#endif /* defined(__need_va_copy) */

#endif /* __MVS__ */
`,"__stdarg___gnuc_va_list.h":`/*===---- __stdarg___gnuc_va_list.h - Definition of __gnuc_va_list ---------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __GNUC_VA_LIST
#define __GNUC_VA_LIST
typedef __builtin_va_list __gnuc_va_list;
#endif
`,"__stdarg___va_copy.h":`/*===---- __stdarg___va_copy.h - Definition of __va_copy -------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __va_copy
#define __va_copy(d, s) __builtin_va_copy(d, s)
#endif
`,"__stdarg_header_macro.h":`/*===---- __stdarg_header_macro.h ------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDARG_H
#define __STDARG_H
#endif
`,"__stdarg_va_arg.h":`/*===---- __stdarg_va_arg.h - Definitions of va_start, va_arg, va_end-------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef va_arg

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
/* C23 uses a special builtin. */
#define va_start(...) __builtin_c23_va_start(__VA_ARGS__)
#else
/* Versions before C23 do require the second parameter. */
#define va_start(ap, param) __builtin_va_start(ap, param)
#endif
#define va_end(ap) __builtin_va_end(ap)
#define va_arg(ap, type) __builtin_va_arg(ap, type)

#endif
`,"__stdarg_va_copy.h":`/*===---- __stdarg_va_copy.h - Definition of va_copy------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef va_copy
#define va_copy(dest, src) __builtin_va_copy(dest, src)
#endif
`,"__stdarg_va_list.h":`/*===---- __stdarg_va_list.h - Definition of va_list -----------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef _VA_LIST
#define _VA_LIST
typedef __builtin_va_list va_list;
#endif
`,"stdatomic.h":`/*===---- stdatomic.h - Standard header for atomic types and operations -----===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_STDATOMIC_H
#define __CLANG_STDATOMIC_H

/* If we're hosted, fall back to the system's stdatomic.h. FreeBSD, for
 * example, already has a Clang-compatible stdatomic.h header.
 *
 * Exclude the MSVC path as well as the MSVC header as of the 14.31.30818
 * explicitly disallows \`stdatomic.h\` in the C mode via an \`#error\`.  Fallback
 * to the clang resource header until that is fully supported.  The
 * \`stdatomic.h\` header requires C++23 or newer.
 */
#if __STDC_HOSTED__ &&                                                         \\
    __has_include_next(<stdatomic.h>) &&                                       \\
    (!defined(_MSC_VER) || (defined(__cplusplus) && __cplusplus >= 202002L))
# include_next <stdatomic.h>
#else

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 7.17.1 Introduction */

#define ATOMIC_BOOL_LOCK_FREE       __CLANG_ATOMIC_BOOL_LOCK_FREE
#define ATOMIC_CHAR_LOCK_FREE       __CLANG_ATOMIC_CHAR_LOCK_FREE
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define ATOMIC_CHAR8_T_LOCK_FREE    __CLANG_ATOMIC_CHAR8_T_LOCK_FREE
#endif
#define ATOMIC_CHAR16_T_LOCK_FREE   __CLANG_ATOMIC_CHAR16_T_LOCK_FREE
#define ATOMIC_CHAR32_T_LOCK_FREE   __CLANG_ATOMIC_CHAR32_T_LOCK_FREE
#define ATOMIC_WCHAR_T_LOCK_FREE    __CLANG_ATOMIC_WCHAR_T_LOCK_FREE
#define ATOMIC_SHORT_LOCK_FREE      __CLANG_ATOMIC_SHORT_LOCK_FREE
#define ATOMIC_INT_LOCK_FREE        __CLANG_ATOMIC_INT_LOCK_FREE
#define ATOMIC_LONG_LOCK_FREE       __CLANG_ATOMIC_LONG_LOCK_FREE
#define ATOMIC_LLONG_LOCK_FREE      __CLANG_ATOMIC_LLONG_LOCK_FREE
#define ATOMIC_POINTER_LOCK_FREE    __CLANG_ATOMIC_POINTER_LOCK_FREE

/* 7.17.2 Initialization */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ < 202311L) ||               \\
    defined(__cplusplus)
/* ATOMIC_VAR_INIT was removed in C23, but still remains in C++23. */
#define ATOMIC_VAR_INIT(value) (value)
#endif

#if ((defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201710L &&              \\
      __STDC_VERSION__ < 202311L) ||                                           \\
     (defined(__cplusplus) && __cplusplus >= 202002L)) &&                      \\
    !defined(_CLANG_DISABLE_CRT_DEPRECATION_WARNINGS)
/* ATOMIC_VAR_INIT was deprecated in C17 and C++20. */
#pragma clang deprecated(ATOMIC_VAR_INIT)
#endif
#define atomic_init __c11_atomic_init

/* 7.17.3 Order and consistency */

typedef enum memory_order {
  memory_order_relaxed = __ATOMIC_RELAXED,
  memory_order_consume = __ATOMIC_CONSUME,
  memory_order_acquire = __ATOMIC_ACQUIRE,
  memory_order_release = __ATOMIC_RELEASE,
  memory_order_acq_rel = __ATOMIC_ACQ_REL,
  memory_order_seq_cst = __ATOMIC_SEQ_CST
} memory_order;

#define kill_dependency(y) (y)

/* 7.17.4 Fences */

/* These should be provided by the libc implementation. */
void atomic_thread_fence(memory_order);
void atomic_signal_fence(memory_order);

#define atomic_thread_fence(order) __c11_atomic_thread_fence(order)
#define atomic_signal_fence(order) __c11_atomic_signal_fence(order)

/* 7.17.5 Lock-free property */

#define atomic_is_lock_free(obj) __c11_atomic_is_lock_free(sizeof(*(obj)))

/* 7.17.6 Atomic integer types */

#ifdef __cplusplus
typedef _Atomic(bool)               atomic_bool;
#else
typedef _Atomic(_Bool)              atomic_bool;
#endif
typedef _Atomic(char)               atomic_char;
typedef _Atomic(signed char)        atomic_schar;
typedef _Atomic(unsigned char)      atomic_uchar;
typedef _Atomic(short)              atomic_short;
typedef _Atomic(unsigned short)     atomic_ushort;
typedef _Atomic(int)                atomic_int;
typedef _Atomic(unsigned int)       atomic_uint;
typedef _Atomic(long)               atomic_long;
typedef _Atomic(unsigned long)      atomic_ulong;
typedef _Atomic(long long)          atomic_llong;
typedef _Atomic(unsigned long long) atomic_ullong;
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
typedef _Atomic(unsigned char)      atomic_char8_t;
#endif
typedef _Atomic(uint_least16_t)     atomic_char16_t;
typedef _Atomic(uint_least32_t)     atomic_char32_t;
typedef _Atomic(wchar_t)            atomic_wchar_t;
typedef _Atomic(int_least8_t)       atomic_int_least8_t;
typedef _Atomic(uint_least8_t)      atomic_uint_least8_t;
typedef _Atomic(int_least16_t)      atomic_int_least16_t;
typedef _Atomic(uint_least16_t)     atomic_uint_least16_t;
typedef _Atomic(int_least32_t)      atomic_int_least32_t;
typedef _Atomic(uint_least32_t)     atomic_uint_least32_t;
typedef _Atomic(int_least64_t)      atomic_int_least64_t;
typedef _Atomic(uint_least64_t)     atomic_uint_least64_t;
typedef _Atomic(int_fast8_t)        atomic_int_fast8_t;
typedef _Atomic(uint_fast8_t)       atomic_uint_fast8_t;
typedef _Atomic(int_fast16_t)       atomic_int_fast16_t;
typedef _Atomic(uint_fast16_t)      atomic_uint_fast16_t;
typedef _Atomic(int_fast32_t)       atomic_int_fast32_t;
typedef _Atomic(uint_fast32_t)      atomic_uint_fast32_t;
typedef _Atomic(int_fast64_t)       atomic_int_fast64_t;
typedef _Atomic(uint_fast64_t)      atomic_uint_fast64_t;
typedef _Atomic(intptr_t)           atomic_intptr_t;
typedef _Atomic(uintptr_t)          atomic_uintptr_t;
typedef _Atomic(size_t)             atomic_size_t;
typedef _Atomic(ptrdiff_t)          atomic_ptrdiff_t;
typedef _Atomic(intmax_t)           atomic_intmax_t;
typedef _Atomic(uintmax_t)          atomic_uintmax_t;

/* 7.17.7 Operations on atomic types */

#define atomic_store(object, desired) __c11_atomic_store(object, desired, __ATOMIC_SEQ_CST)
#define atomic_store_explicit __c11_atomic_store

#define atomic_load(object) __c11_atomic_load(object, __ATOMIC_SEQ_CST)
#define atomic_load_explicit __c11_atomic_load

#define atomic_exchange(object, desired) __c11_atomic_exchange(object, desired, __ATOMIC_SEQ_CST)
#define atomic_exchange_explicit __c11_atomic_exchange

#define atomic_compare_exchange_strong(object, expected, desired) __c11_atomic_compare_exchange_strong(object, expected, desired, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)
#define atomic_compare_exchange_strong_explicit __c11_atomic_compare_exchange_strong

#define atomic_compare_exchange_weak(object, expected, desired) __c11_atomic_compare_exchange_weak(object, expected, desired, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)
#define atomic_compare_exchange_weak_explicit __c11_atomic_compare_exchange_weak

#define atomic_fetch_add(object, operand) __c11_atomic_fetch_add(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_add_explicit __c11_atomic_fetch_add

#define atomic_fetch_sub(object, operand) __c11_atomic_fetch_sub(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_sub_explicit __c11_atomic_fetch_sub

#define atomic_fetch_or(object, operand) __c11_atomic_fetch_or(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_or_explicit __c11_atomic_fetch_or

#define atomic_fetch_xor(object, operand) __c11_atomic_fetch_xor(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_xor_explicit __c11_atomic_fetch_xor

#define atomic_fetch_and(object, operand) __c11_atomic_fetch_and(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_and_explicit __c11_atomic_fetch_and

/* 7.17.8 Atomic flag type and operations */

typedef struct atomic_flag { atomic_bool _Value; } atomic_flag;

#ifdef __cplusplus
#define ATOMIC_FLAG_INIT {false}
#else
#define ATOMIC_FLAG_INIT { 0 }
#endif

/* These should be provided by the libc implementation. */
#ifdef __cplusplus
bool atomic_flag_test_and_set(volatile atomic_flag *);
bool atomic_flag_test_and_set_explicit(volatile atomic_flag *, memory_order);
#else
_Bool atomic_flag_test_and_set(volatile atomic_flag *);
_Bool atomic_flag_test_and_set_explicit(volatile atomic_flag *, memory_order);
#endif
void atomic_flag_clear(volatile atomic_flag *);
void atomic_flag_clear_explicit(volatile atomic_flag *, memory_order);

#define atomic_flag_test_and_set(object) __c11_atomic_exchange(&(object)->_Value, 1, __ATOMIC_SEQ_CST)
#define atomic_flag_test_and_set_explicit(object, order) __c11_atomic_exchange(&(object)->_Value, 1, order)

#define atomic_flag_clear(object) __c11_atomic_store(&(object)->_Value, 0, __ATOMIC_SEQ_CST)
#define atomic_flag_clear_explicit(object, order) __c11_atomic_store(&(object)->_Value, 0, order)

#ifdef __cplusplus
}
#endif

#endif /* __STDC_HOSTED__ */
#endif /* __CLANG_STDATOMIC_H */

`,"stdbool.h":`/*===---- stdbool.h - Standard header for booleans -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDBOOL_H
#define __STDBOOL_H

#define __bool_true_false_are_defined 1

#if defined(__MVS__) && __has_include_next(<stdbool.h>)
#include_next <stdbool.h>
#else

#if defined(__STDC_VERSION__) && __STDC_VERSION__ > 201710L
/* FIXME: We should be issuing a deprecation warning here, but cannot yet due
 * to system headers which include this header file unconditionally.
 */
#elif !defined(__cplusplus)
#define bool _Bool
#define true 1
#define false 0
#elif defined(__GNUC__) && !defined(__STRICT_ANSI__)
/* Define _Bool as a GNU extension. */
#define _Bool bool
#if defined(__cplusplus) && __cplusplus < 201103L
/* For C++98, define bool, false, true as a GNU extension. */
#define bool bool
#define false false
#define true true
#endif
#endif

#endif /* __MVS__ */
#endif /* __STDBOOL_H */
`,"stdcountof.h":`/*===---- stdcountof.h - Standard header for countof -----------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDCOUNTOF_H
#define __STDCOUNTOF_H

#define countof _Countof

#endif /* __STDCOUNTOF_H */
`,"stdckdint.h":`/*===---- stdckdint.h - Standard header for checking integer----------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDCKDINT_H
#define __STDCKDINT_H

/* If we're hosted, fall back to the system's stdckdint.h. FreeBSD, for
 * example, already has a Clang-compatible stdckdint.h header.
 *
 * The \`stdckdint.h\` header requires C 23 or newer.
 */
#if __STDC_HOSTED__ && __has_include_next(<stdckdint.h>)
#include_next <stdckdint.h>
#else

/* C23 7.20.1 Defines several macros for performing checked integer arithmetic*/

#define __STDC_VERSION_STDCKDINT_H__ 202311L

// Both A and B shall be any integer type other than "plain" char, bool, a bit-
// precise integer type, or an enumerated type, and they need not be the same.

// R shall be a modifiable lvalue of any integer type other than "plain" char,
// bool, a bit-precise integer type, or an enumerated type. It shouldn't be
// short type, either. Otherwise, it may be unable to hold two the result of
// operating two 'int's.

// A diagnostic message will be produced if A or B are not suitable integer
// types, or if R is not a modifiable lvalue of a suitable integer type or R
// is short type.
#define ckd_add(R, A, B) __builtin_add_overflow((A), (B), (R))
#define ckd_sub(R, A, B) __builtin_sub_overflow((A), (B), (R))
#define ckd_mul(R, A, B) __builtin_mul_overflow((A), (B), (R))

#endif /* __STDC_HOSTED__ */
#endif /* __STDCKDINT_H */
`,"stddef.h":`/*===---- stddef.h - Basic type definitions --------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * This header is designed to be included multiple times. If any of the __need_
 * macros are defined, then only that subset of interfaces are provided. This
 * can be useful for POSIX headers that need to not expose all of stddef.h, but
 * need to use some of its interfaces. Otherwise this header provides all of
 * the expected interfaces.
 *
 * When clang modules are enabled, this header is a textual header to support
 * the multiple include behavior. As such, it doesn't directly declare anything
 * so that it doesn't add duplicate declarations to all of its includers'
 * modules.
 */
#if defined(__MVS__) && __has_include_next(<stddef.h>)
#undef __need_ptrdiff_t
#undef __need_size_t
#undef __need_rsize_t
#undef __need_wchar_t
#undef __need_NULL
#undef __need_nullptr_t
#undef __need_unreachable
#undef __need_max_align_t
#undef __need_offsetof
#undef __need_wint_t
#include <__stddef_header_macro.h>
#include_next <stddef.h>

#else

#if !defined(__need_ptrdiff_t) && !defined(__need_size_t) &&                   \\
    !defined(__need_rsize_t) && !defined(__need_wchar_t) &&                    \\
    !defined(__need_NULL) && !defined(__need_nullptr_t) &&                     \\
    !defined(__need_unreachable) && !defined(__need_max_align_t) &&            \\
    !defined(__need_offsetof) && !defined(__need_wint_t)
#define __need_ptrdiff_t
#define __need_size_t
/* ISO9899:2011 7.20 (C11 Annex K): Define rsize_t if __STDC_WANT_LIB_EXT1__ is
 * enabled. */
#if defined(__STDC_WANT_LIB_EXT1__) && __STDC_WANT_LIB_EXT1__ >= 1
#define __need_rsize_t
#endif
#define __need_wchar_t
#if !defined(__STDDEF_H) || __has_feature(modules)
/*
 * __stddef_null.h is special when building without modules: if __need_NULL is
 * set, then it will unconditionally redefine NULL. To avoid stepping on client
 * definitions of NULL, __need_NULL should only be set the first time this
 * header is included, that is when __STDDEF_H is not defined. However, when
 * building with modules, this header is a textual header and needs to
 * unconditionally include __stdef_null.h to support multiple submodules
 * exporting _Builtin_stddef.null. Take module SM with submodules A and B, whose
 * headers both include stddef.h When SM.A builds, __STDDEF_H will be defined.
 * When SM.B builds, the definition from SM.A will leak when building without
 * local submodule visibility. stddef.h wouldn't include __stddef_null.h, and
 * SM.B wouldn't import _Builtin_stddef.null, and SM.B's \`export *\` wouldn't
 * export NULL as expected. When building with modules, always include
 * __stddef_null.h so that everything works as expected.
 */
#define __need_NULL
#endif
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    defined(__cplusplus)
#define __need_nullptr_t
#endif
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define __need_unreachable
#endif
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L)
#define __need_max_align_t
#endif
#define __need_offsetof
/* wint_t is provided by <wchar.h> and not <stddef.h>. It's here
 * for compatibility, but must be explicitly requested. Therefore
 * __need_wint_t is intentionally not defined here. */
#include <__stddef_header_macro.h>
#endif

#if defined(__need_ptrdiff_t)
#include <__stddef_ptrdiff_t.h>
#undef __need_ptrdiff_t
#endif /* defined(__need_ptrdiff_t) */

#if defined(__need_size_t)
#include <__stddef_size_t.h>
#undef __need_size_t
#endif /*defined(__need_size_t) */

#if defined(__need_rsize_t)
#include <__stddef_rsize_t.h>
#undef __need_rsize_t
#endif /* defined(__need_rsize_t) */

#if defined(__need_wchar_t)
#include <__stddef_wchar_t.h>
#undef __need_wchar_t
#endif /* defined(__need_wchar_t) */

#if defined(__need_NULL)
#include <__stddef_null.h>
#undef __need_NULL
#endif /* defined(__need_NULL) */

#if defined(__need_nullptr_t)
#include <__stddef_nullptr_t.h>
#undef __need_nullptr_t
#endif /* defined(__need_nullptr_t) */

#if defined(__need_unreachable)
#include <__stddef_unreachable.h>
#undef __need_unreachable
#endif /* defined(__need_unreachable) */

#if defined(__need_max_align_t)
#include <__stddef_max_align_t.h>
#undef __need_max_align_t
#endif /* defined(__need_max_align_t) */

#if defined(__need_offsetof)
#include <__stddef_offsetof.h>
#undef __need_offsetof
#endif /* defined(__need_offsetof) */

/* Some C libraries expect to see a wint_t here. Others (notably MinGW) will use
__WINT_TYPE__ directly; accommodate both by requiring __need_wint_t */
#if defined(__need_wint_t)
#include <__stddef_wint_t.h>
#undef __need_wint_t
#endif /* __need_wint_t */

#endif /* __MVS__ */
`,"stddefer.h":`/*===---- stddefer.h - Standard header for 'defer' -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_STDDEFER_H
#define __CLANG_STDDEFER_H

/* Provide 'defer' if '_Defer' is supported. */
#ifdef __STDC_DEFER_TS25755__
#define __STDC_VERSION_STDDEFER_H__ 202602L
#define defer _Defer
#endif

#endif /* __CLANG_STDDEFER_H */
`,"__stddef_header_macro.h":`/*===---- __stddef_header_macro.h ------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDDEF_H
#define __STDDEF_H
#endif
`,"__stddef_max_align_t.h":`/*===---- __stddef_max_align_t.h - Definition of max_align_t ---------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_MAX_ALIGN_T_DEFINED
#define __CLANG_MAX_ALIGN_T_DEFINED

#if defined(_MSC_VER)
typedef double max_align_t;
#elif defined(__APPLE__)
typedef long double max_align_t;
#else
// Define 'max_align_t' to match the GCC definition.
typedef struct {
  long long __clang_max_align_nonce1
      __attribute__((__aligned__(__alignof__(long long))));
  long double __clang_max_align_nonce2
      __attribute__((__aligned__(__alignof__(long double))));
} max_align_t;
#endif

#endif
`,"__stddef_null.h":`/*===---- __stddef_null.h - Definition of NULL -----------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#if !defined(NULL) || !__building_module(_Builtin_stddef)

/* linux/stddef.h will define NULL to 0. glibc (and other) headers then define
 * __need_NULL and rely on stddef.h to redefine NULL to the correct value again.
 * Modules don't support redefining macros like that, but support that pattern
 * in the non-modules case.
 */
#undef NULL

#ifdef __cplusplus
#if !defined(__MINGW32__) && !defined(_MSC_VER)
#define NULL __null
#else
#define NULL 0
#endif
#else
#define NULL ((void*)0)
#endif

#endif
`,"__stddef_nullptr_t.h":`/*===---- __stddef_nullptr_t.h - Definition of nullptr_t -------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_NULLPTR_T) ||                                                    \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _NULLPTR_T

#ifdef __cplusplus
#if defined(_MSC_EXTENSIONS) && defined(_NATIVE_NULLPTR_SUPPORTED)
namespace std {
typedef decltype(nullptr) nullptr_t;
}
using ::std::nullptr_t;
#endif
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
typedef typeof(nullptr) nullptr_t;
#endif

#endif
`,"__stddef_offsetof.h":`/*===---- __stddef_offsetof.h - Definition of offsetof ---------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(offsetof) ||                                                      \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define offsetof(t, d) __builtin_offsetof(t, d)
#endif
`,"__stddef_ptrdiff_t.h":`/*===---- __stddef_ptrdiff_t.h - Definition of ptrdiff_t -------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_PTRDIFF_T) ||                                                    \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _PTRDIFF_T

typedef __PTRDIFF_TYPE__ ptrdiff_t;

#endif
`,"__stddef_rsize_t.h":`/*===---- __stddef_rsize_t.h - Definition of rsize_t -----------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_RSIZE_T) ||                                                      \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _RSIZE_T

typedef __SIZE_TYPE__ rsize_t;

#endif
`,"__stddef_size_t.h":`/*===---- __stddef_size_t.h - Definition of size_t -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_SIZE_T) ||                                                       \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _SIZE_T

typedef __SIZE_TYPE__ size_t;

#endif
`,"__stddef_unreachable.h":`/*===---- __stddef_unreachable.h - Definition of unreachable ---------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __cplusplus

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(unreachable) ||                                                   \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define unreachable() __builtin_unreachable()
#endif

#endif
`,"__stddef_wchar_t.h":`/*===---- __stddef_wchar.h - Definition of wchar_t -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#if !defined(__cplusplus) || (defined(_MSC_VER) && !_NATIVE_WCHAR_T_DEFINED)

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_WCHAR_T) ||                                                      \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _WCHAR_T

#ifdef _MSC_EXTENSIONS
#define _WCHAR_T_DEFINED
#endif

typedef __WCHAR_TYPE__ wchar_t;

#endif

#endif
`,"__stddef_wint_t.h":`/*===---- __stddef_wint.h - Definition of wint_t ---------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef _WINT_T
#define _WINT_T

typedef __WINT_TYPE__ wint_t;

#endif
`,"stdint.h":`/*===---- stdint.h - Standard header for sized integer types --------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_STDINT_H
// AIX system headers need stdint.h to be re-enterable while _STD_TYPES_T
// is defined until an inclusion of it without _STD_TYPES_T occurs, in which
// case the header guard macro is defined.
#if !defined(_AIX) || !defined(_STD_TYPES_T) || !defined(__STDC_HOSTED__)
#define __CLANG_STDINT_H
#endif

#if defined(__MVS__) && __has_include_next(<stdint.h>)
#include_next <stdint.h>
#else

/* If we're hosted, fall back to the system's stdint.h, which might have
 * additional definitions.
 */
#if __STDC_HOSTED__ && __has_include_next(<stdint.h>)

// C99 7.18.3 Limits of other integer types
//
//  Footnote 219, 220: C++ implementations should define these macros only when
//  __STDC_LIMIT_MACROS is defined before <stdint.h> is included.
//
//  Footnote 222: C++ implementations should define these macros only when
//  __STDC_CONSTANT_MACROS is defined before <stdint.h> is included.
//
// C++11 [cstdint.syn]p2:
//
//  The macros defined by <cstdint> are provided unconditionally. In particular,
//  the symbols __STDC_LIMIT_MACROS and __STDC_CONSTANT_MACROS (mentioned in
//  footnotes 219, 220, and 222 in the C standard) play no role in C++.
//
// C11 removed the problematic footnotes.
//
// Work around this inconsistency by always defining those macros in C++ mode,
// so that a C library implementation which follows the C99 standard can be
// used in C++.
# ifdef __cplusplus
#  if !defined(__STDC_LIMIT_MACROS)
#   define __STDC_LIMIT_MACROS
#   define __STDC_LIMIT_MACROS_DEFINED_BY_CLANG
#  endif
#  if !defined(__STDC_CONSTANT_MACROS)
#   define __STDC_CONSTANT_MACROS
#   define __STDC_CONSTANT_MACROS_DEFINED_BY_CLANG
#  endif
# endif

# include_next <stdint.h>

# ifdef __STDC_LIMIT_MACROS_DEFINED_BY_CLANG
#  undef __STDC_LIMIT_MACROS
#  undef __STDC_LIMIT_MACROS_DEFINED_BY_CLANG
# endif
# ifdef __STDC_CONSTANT_MACROS_DEFINED_BY_CLANG
#  undef __STDC_CONSTANT_MACROS
#  undef __STDC_CONSTANT_MACROS_DEFINED_BY_CLANG
# endif

#else

/* C99 7.18.1.1 Exact-width integer types.
 * C99 7.18.1.2 Minimum-width integer types.
 * C99 7.18.1.3 Fastest minimum-width integer types.
 *
 * The standard requires that exact-width type be defined for 8-, 16-, 32-, and
 * 64-bit types if they are implemented. Other exact width types are optional.
 * This implementation defines an exact-width types for every integer width
 * that is represented in the standard integer types.
 *
 * The standard also requires minimum-width types be defined for 8-, 16-, 32-,
 * and 64-bit widths regardless of whether there are corresponding exact-width
 * types.
 *
 * To accommodate targets that are missing types that are exactly 8, 16, 32, or
 * 64 bits wide, this implementation takes an approach of cascading
 * redefinitions, redefining __int_leastN_t to successively smaller exact-width
 * types. It is therefore important that the types are defined in order of
 * descending widths.
 *
 * We currently assume that the minimum-width types and the fastest
 * minimum-width types are the same. This is allowed by the standard, but is
 * suboptimal.
 *
 * In violation of the standard, some targets do not implement a type that is
 * wide enough to represent all of the required widths (8-, 16-, 32-, 64-bit).
 * To accommodate these targets, a required minimum-width type is only
 * defined if there exists an exact-width type of equal or greater width.
 */

#ifdef __INT64_TYPE__
# ifndef __int8_t_defined /* glibc sys/types.h also defines int64_t*/
typedef __INT64_TYPE__ int64_t;
# endif /* __int8_t_defined */
typedef __UINT64_TYPE__ uint64_t;
# undef __int_least64_t
# define __int_least64_t int64_t
# undef __uint_least64_t
# define __uint_least64_t uint64_t
# undef __int_least32_t
# define __int_least32_t int64_t
# undef __uint_least32_t
# define __uint_least32_t uint64_t
# undef __int_least16_t
# define __int_least16_t int64_t
# undef __uint_least16_t
# define __uint_least16_t uint64_t
# undef __int_least8_t
# define __int_least8_t int64_t
# undef __uint_least8_t
# define __uint_least8_t uint64_t
#endif /* __INT64_TYPE__ */

#ifdef __int_least64_t
typedef __int_least64_t int_least64_t;
typedef __uint_least64_t uint_least64_t;
typedef __int_least64_t int_fast64_t;
typedef __uint_least64_t uint_fast64_t;
#endif /* __int_least64_t */

#ifdef __INT56_TYPE__
typedef __INT56_TYPE__ int56_t;
typedef __UINT56_TYPE__ uint56_t;
typedef int56_t int_least56_t;
typedef uint56_t uint_least56_t;
typedef int56_t int_fast56_t;
typedef uint56_t uint_fast56_t;
# undef __int_least32_t
# define __int_least32_t int56_t
# undef __uint_least32_t
# define __uint_least32_t uint56_t
# undef __int_least16_t
# define __int_least16_t int56_t
# undef __uint_least16_t
# define __uint_least16_t uint56_t
# undef __int_least8_t
# define __int_least8_t int56_t
# undef __uint_least8_t
# define __uint_least8_t uint56_t
#endif /* __INT56_TYPE__ */


#ifdef __INT48_TYPE__
typedef __INT48_TYPE__ int48_t;
typedef __UINT48_TYPE__ uint48_t;
typedef int48_t int_least48_t;
typedef uint48_t uint_least48_t;
typedef int48_t int_fast48_t;
typedef uint48_t uint_fast48_t;
# undef __int_least32_t
# define __int_least32_t int48_t
# undef __uint_least32_t
# define __uint_least32_t uint48_t
# undef __int_least16_t
# define __int_least16_t int48_t
# undef __uint_least16_t
# define __uint_least16_t uint48_t
# undef __int_least8_t
# define __int_least8_t int48_t
# undef __uint_least8_t
# define __uint_least8_t uint48_t
#endif /* __INT48_TYPE__ */


#ifdef __INT40_TYPE__
typedef __INT40_TYPE__ int40_t;
typedef __UINT40_TYPE__ uint40_t;
typedef int40_t int_least40_t;
typedef uint40_t uint_least40_t;
typedef int40_t int_fast40_t;
typedef uint40_t uint_fast40_t;
# undef __int_least32_t
# define __int_least32_t int40_t
# undef __uint_least32_t
# define __uint_least32_t uint40_t
# undef __int_least16_t
# define __int_least16_t int40_t
# undef __uint_least16_t
# define __uint_least16_t uint40_t
# undef __int_least8_t
# define __int_least8_t int40_t
# undef __uint_least8_t
# define __uint_least8_t uint40_t
#endif /* __INT40_TYPE__ */


#ifdef __INT32_TYPE__

# ifndef __int8_t_defined /* glibc sys/types.h also defines int32_t*/
typedef __INT32_TYPE__ int32_t;
# endif /* __int8_t_defined */

# ifndef __uint32_t_defined  /* more glibc compatibility */
# define __uint32_t_defined
typedef __UINT32_TYPE__ uint32_t;
# endif /* __uint32_t_defined */

# undef __int_least32_t
# define __int_least32_t int32_t
# undef __uint_least32_t
# define __uint_least32_t uint32_t
# undef __int_least16_t
# define __int_least16_t int32_t
# undef __uint_least16_t
# define __uint_least16_t uint32_t
# undef __int_least8_t
# define __int_least8_t int32_t
# undef __uint_least8_t
# define __uint_least8_t uint32_t
#endif /* __INT32_TYPE__ */

#ifdef __int_least32_t
typedef __int_least32_t int_least32_t;
typedef __uint_least32_t uint_least32_t;
typedef __int_least32_t int_fast32_t;
typedef __uint_least32_t uint_fast32_t;
#endif /* __int_least32_t */

#ifdef __INT24_TYPE__
typedef __INT24_TYPE__ int24_t;
typedef __UINT24_TYPE__ uint24_t;
typedef int24_t int_least24_t;
typedef uint24_t uint_least24_t;
typedef int24_t int_fast24_t;
typedef uint24_t uint_fast24_t;
# undef __int_least16_t
# define __int_least16_t int24_t
# undef __uint_least16_t
# define __uint_least16_t uint24_t
# undef __int_least8_t
# define __int_least8_t int24_t
# undef __uint_least8_t
# define __uint_least8_t uint24_t
#endif /* __INT24_TYPE__ */

#ifdef __INT16_TYPE__
#ifndef __int8_t_defined /* glibc sys/types.h also defines int16_t*/
typedef __INT16_TYPE__ int16_t;
#endif /* __int8_t_defined */
typedef __UINT16_TYPE__ uint16_t;
# undef __int_least16_t
# define __int_least16_t int16_t
# undef __uint_least16_t
# define __uint_least16_t uint16_t
# undef __int_least8_t
# define __int_least8_t int16_t
# undef __uint_least8_t
# define __uint_least8_t uint16_t
#endif /* __INT16_TYPE__ */

#ifdef __int_least16_t
typedef __int_least16_t int_least16_t;
typedef __uint_least16_t uint_least16_t;
typedef __int_least16_t int_fast16_t;
typedef __uint_least16_t uint_fast16_t;
#endif /* __int_least16_t */


#ifdef __INT8_TYPE__
#ifndef __int8_t_defined  /* glibc sys/types.h also defines int8_t*/
typedef __INT8_TYPE__ int8_t;
#endif /* __int8_t_defined */
typedef __UINT8_TYPE__ uint8_t;
# undef __int_least8_t
# define __int_least8_t int8_t
# undef __uint_least8_t
# define __uint_least8_t uint8_t
#endif /* __INT8_TYPE__ */

#ifdef __int_least8_t
typedef __int_least8_t int_least8_t;
typedef __uint_least8_t uint_least8_t;
typedef __int_least8_t int_fast8_t;
typedef __uint_least8_t uint_fast8_t;
#endif /* __int_least8_t */

/* prevent glibc sys/types.h from defining conflicting types */
#ifndef __int8_t_defined
# define __int8_t_defined
#endif /* __int8_t_defined */

/* C99 7.18.1.4 Integer types capable of holding object pointers.
 */
#define __stdint_join3(a,b,c) a ## b ## c

#ifndef _INTPTR_T
#ifndef __intptr_t_defined
typedef __INTPTR_TYPE__ intptr_t;
#define __intptr_t_defined
#define _INTPTR_T
#endif
#endif

#ifndef _UINTPTR_T
typedef __UINTPTR_TYPE__ uintptr_t;
#define _UINTPTR_T
#endif

/* C99 7.18.1.5 Greatest-width integer types.
 */
typedef __INTMAX_TYPE__  intmax_t;
typedef __UINTMAX_TYPE__ uintmax_t;

/* C99 7.18.4 Macros for minimum-width integer constants.
 *
 * The standard requires that integer constant macros be defined for all the
 * minimum-width types defined above. As 8-, 16-, 32-, and 64-bit minimum-width
 * types are required, the corresponding integer constant macros are defined
 * here. This implementation also defines minimum-width types for every other
 * integer width that the target implements, so corresponding macros are
 * defined below, too.
 *
 * Note that C++ should not check __STDC_CONSTANT_MACROS here, contrary to the
 * claims of the C standard (see C++ 18.3.1p2, [cstdint.syn]).
 */

#ifdef __int_least64_t
#define INT64_C(v) __INT64_C(v)
#define UINT64_C(v) __UINT64_C(v)
#endif /* __int_least64_t */


#ifdef __INT56_TYPE__
#define INT56_C(v) __INT56_C(v)
#define UINT56_C(v) __UINT56_C(v)
#endif /* __INT56_TYPE__ */


#ifdef __INT48_TYPE__
#define INT48_C(v) __INT48_C(v)
#define UINT48_C(v) __UINT48_C(v)
#endif /* __INT48_TYPE__ */


#ifdef __INT40_TYPE__
#define INT40_C(v) __INT40_C(v)
#define UINT40_C(v) __UINT40_C(v)
#endif /* __INT40_TYPE__ */


#ifdef __int_least32_t
#define INT32_C(v) __INT32_C(v)
#define UINT32_C(v) __UINT32_C(v)
#endif /* __int_least32_t */


#ifdef __INT24_TYPE__
#define INT24_C(v) __INT24_C(v)
#define UINT24_C(v) __UINT24_C(v)
#endif /* __INT24_TYPE__ */


#ifdef __int_least16_t
#define INT16_C(v) __INT16_C(v)
#define UINT16_C(v) __UINT16_C(v)
#endif /* __int_least16_t */


#ifdef __int_least8_t
#define INT8_C(v) __INT8_C(v)
#define UINT8_C(v) __UINT8_C(v)
#endif /* __int_least8_t */


/* C99 7.18.2.1 Limits of exact-width integer types.
 * C99 7.18.2.2 Limits of minimum-width integer types.
 * C99 7.18.2.3 Limits of fastest minimum-width integer types.
 *
 * The presence of limit macros are completely optional in C99.  This
 * implementation defines limits for all of the types (exact- and
 * minimum-width) that it defines above, using the limits of the minimum-width
 * type for any types that do not have exact-width representations.
 *
 * As in the type definitions, this section takes an approach of
 * successive-shrinking to determine which limits to use for the standard (8,
 * 16, 32, 64) bit widths when they don't have exact representations. It is
 * therefore important that the definitions be kept in order of decending
 * widths.
 *
 * Note that C++ should not check __STDC_LIMIT_MACROS here, contrary to the
 * claims of the C standard (see C++ 18.3.1p2, [cstdint.syn]).
 */

#ifdef __INT64_TYPE__
# define INT64_MAX           INT64_C( 9223372036854775807)
# define INT64_MIN         (-INT64_C( 9223372036854775807)-1)
# define UINT64_MAX         UINT64_C(18446744073709551615)

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT64_WIDTH         64
# define INT64_WIDTH          UINT64_WIDTH

# define __UINT_LEAST64_WIDTH UINT64_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT64_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT64_WIDTH
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX UINT64_MAX
#endif /* __STDC_VERSION__ */

# define __INT_LEAST64_MIN   INT64_MIN
# define __INT_LEAST64_MAX   INT64_MAX
# define __UINT_LEAST64_MAX UINT64_MAX
# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT64_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT64_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT64_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT64_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT64_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT64_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT64_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT64_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT64_MAX
#endif /* __INT64_TYPE__ */

#ifdef __INT_LEAST64_MIN
# define INT_LEAST64_MIN   __INT_LEAST64_MIN
# define INT_LEAST64_MAX   __INT_LEAST64_MAX
# define UINT_LEAST64_MAX __UINT_LEAST64_MAX
# define INT_FAST64_MIN    __INT_LEAST64_MIN
# define INT_FAST64_MAX    __INT_LEAST64_MAX
# define UINT_FAST64_MAX  __UINT_LEAST64_MAX

#if defined(__STDC_VERSION__) &&  __STDC_VERSION__ >= 202311L
# define UINT_LEAST64_WIDTH __UINT_LEAST64_WIDTH
# define INT_LEAST64_WIDTH  UINT_LEAST64_WIDTH
# define UINT_FAST64_WIDTH  __UINT_LEAST64_WIDTH
# define INT_FAST64_WIDTH   UINT_FAST64_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST64_MIN */


#ifdef __INT56_TYPE__
# define INT56_MAX           INT56_C(36028797018963967)
# define INT56_MIN         (-INT56_C(36028797018963967)-1)
# define UINT56_MAX         UINT56_C(72057594037927935)
# define INT_LEAST56_MIN     INT56_MIN
# define INT_LEAST56_MAX     INT56_MAX
# define UINT_LEAST56_MAX   UINT56_MAX
# define INT_FAST56_MIN      INT56_MIN
# define INT_FAST56_MAX      INT56_MAX
# define UINT_FAST56_MAX    UINT56_MAX

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT56_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT56_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT56_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT56_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT56_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT56_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT56_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT56_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT56_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT56_WIDTH         56
# define INT56_WIDTH          UINT56_WIDTH
# define UINT_LEAST56_WIDTH   UINT56_WIDTH
# define INT_LEAST56_WIDTH    UINT_LEAST56_WIDTH
# define UINT_FAST56_WIDTH    UINT56_WIDTH
# define INT_FAST56_WIDTH     UINT_FAST56_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT56_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT56_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT56_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT56_TYPE__ */


#ifdef __INT48_TYPE__
# define INT48_MAX           INT48_C(140737488355327)
# define INT48_MIN         (-INT48_C(140737488355327)-1)
# define UINT48_MAX         UINT48_C(281474976710655)
# define INT_LEAST48_MIN     INT48_MIN
# define INT_LEAST48_MAX     INT48_MAX
# define UINT_LEAST48_MAX   UINT48_MAX
# define INT_FAST48_MIN      INT48_MIN
# define INT_FAST48_MAX      INT48_MAX
# define UINT_FAST48_MAX    UINT48_MAX

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT48_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT48_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT48_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT48_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT48_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT48_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT48_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT48_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT48_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define UINT48_WIDTH         48
#define INT48_WIDTH          UINT48_WIDTH
#define UINT_LEAST48_WIDTH   UINT48_WIDTH
#define INT_LEAST48_WIDTH    UINT_LEAST48_WIDTH
#define UINT_FAST48_WIDTH    UINT48_WIDTH
#define INT_FAST48_WIDTH     UINT_FAST48_WIDTH
#undef __UINT_LEAST32_WIDTH
#define __UINT_LEAST32_WIDTH UINT48_WIDTH
# undef __UINT_LEAST16_WIDTH
#define __UINT_LEAST16_WIDTH UINT48_WIDTH
# undef __UINT_LEAST8_WIDTH
#define __UINT_LEAST8_WIDTH  UINT48_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT48_TYPE__ */


#ifdef __INT40_TYPE__
# define INT40_MAX           INT40_C(549755813887)
# define INT40_MIN         (-INT40_C(549755813887)-1)
# define UINT40_MAX         UINT40_C(1099511627775)
# define INT_LEAST40_MIN     INT40_MIN
# define INT_LEAST40_MAX     INT40_MAX
# define UINT_LEAST40_MAX   UINT40_MAX
# define INT_FAST40_MIN      INT40_MIN
# define INT_FAST40_MAX      INT40_MAX
# define UINT_FAST40_MAX    UINT40_MAX

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT40_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT40_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT40_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT40_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT40_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT40_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT40_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT40_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT40_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT40_WIDTH         40
# define INT40_WIDTH          UINT40_WIDTH
# define UINT_LEAST40_WIDTH   UINT40_WIDTH
# define INT_LEAST40_WIDTH    UINT_LEAST40_WIDTH
# define UINT_FAST40_WIDTH    UINT40_WIDTH
# define INT_FAST40_WIDTH     UINT_FAST40_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT40_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT40_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT40_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT40_TYPE__ */


#ifdef __INT32_TYPE__
# define INT32_MAX           INT32_C(2147483647)
# define INT32_MIN         (-INT32_C(2147483647)-1)
# define UINT32_MAX         UINT32_C(4294967295)

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT32_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT32_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT32_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT32_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT32_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT32_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT32_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT32_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT32_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT32_WIDTH         32
# define INT32_WIDTH          UINT32_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT32_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT32_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT32_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT32_TYPE__ */

#ifdef __INT_LEAST32_MIN
# define INT_LEAST32_MIN   __INT_LEAST32_MIN
# define INT_LEAST32_MAX   __INT_LEAST32_MAX
# define UINT_LEAST32_MAX __UINT_LEAST32_MAX
# define INT_FAST32_MIN    __INT_LEAST32_MIN
# define INT_FAST32_MAX    __INT_LEAST32_MAX
# define UINT_FAST32_MAX  __UINT_LEAST32_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT_LEAST32_WIDTH __UINT_LEAST32_WIDTH
# define INT_LEAST32_WIDTH  UINT_LEAST32_WIDTH
# define UINT_FAST32_WIDTH  __UINT_LEAST32_WIDTH
# define INT_FAST32_WIDTH   UINT_FAST32_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST32_MIN */


#ifdef __INT24_TYPE__
# define INT24_MAX           INT24_C(8388607)
# define INT24_MIN         (-INT24_C(8388607)-1)
# define UINT24_MAX         UINT24_C(16777215)
# define INT_LEAST24_MIN     INT24_MIN
# define INT_LEAST24_MAX     INT24_MAX
# define UINT_LEAST24_MAX   UINT24_MAX
# define INT_FAST24_MIN      INT24_MIN
# define INT_FAST24_MAX      INT24_MAX
# define UINT_FAST24_MAX    UINT24_MAX

# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT24_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT24_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT24_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT24_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT24_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT24_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT24_WIDTH         24
# define INT24_WIDTH          UINT24_WIDTH
# define UINT_LEAST24_WIDTH   UINT24_WIDTH
# define INT_LEAST24_WIDTH    UINT_LEAST24_WIDTH
# define UINT_FAST24_WIDTH    UINT24_WIDTH
# define INT_FAST24_WIDTH     UINT_FAST24_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT24_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT24_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT24_TYPE__ */


#ifdef __INT16_TYPE__
#define INT16_MAX            INT16_C(32767)
#define INT16_MIN          (-INT16_C(32767)-1)
#define UINT16_MAX          UINT16_C(65535)

# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT16_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT16_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT16_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT16_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT16_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT16_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT16_WIDTH         16
# define INT16_WIDTH          UINT16_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT16_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT16_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT16_TYPE__ */

#ifdef __INT_LEAST16_MIN
# define INT_LEAST16_MIN   __INT_LEAST16_MIN
# define INT_LEAST16_MAX   __INT_LEAST16_MAX
# define UINT_LEAST16_MAX __UINT_LEAST16_MAX
# define INT_FAST16_MIN    __INT_LEAST16_MIN
# define INT_FAST16_MAX    __INT_LEAST16_MAX
# define UINT_FAST16_MAX  __UINT_LEAST16_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT_LEAST16_WIDTH __UINT_LEAST16_WIDTH
# define INT_LEAST16_WIDTH  UINT_LEAST16_WIDTH
# define UINT_FAST16_WIDTH  __UINT_LEAST16_WIDTH
# define INT_FAST16_WIDTH   UINT_FAST16_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST16_MIN */


#ifdef __INT8_TYPE__
# define INT8_MAX            INT8_C(127)
# define INT8_MIN          (-INT8_C(127)-1)
# define UINT8_MAX          UINT8_C(255)

# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT8_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT8_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT8_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT8_WIDTH         8
# define INT8_WIDTH          UINT8_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH UINT8_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT8_TYPE__ */

#ifdef __INT_LEAST8_MIN
# define INT_LEAST8_MIN   __INT_LEAST8_MIN
# define INT_LEAST8_MAX   __INT_LEAST8_MAX
# define UINT_LEAST8_MAX __UINT_LEAST8_MAX
# define INT_FAST8_MIN    __INT_LEAST8_MIN
# define INT_FAST8_MAX    __INT_LEAST8_MAX
# define UINT_FAST8_MAX  __UINT_LEAST8_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT_LEAST8_WIDTH __UINT_LEAST8_WIDTH
# define INT_LEAST8_WIDTH  UINT_LEAST8_WIDTH
# define UINT_FAST8_WIDTH  __UINT_LEAST8_WIDTH
# define INT_FAST8_WIDTH   UINT_FAST8_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST8_MIN */

/* Some utility macros */
#define  __INTN_MIN(n)  __stdint_join3( INT, n, _MIN)
#define  __INTN_MAX(n)  __stdint_join3( INT, n, _MAX)
#define __UINTN_MAX(n)  __stdint_join3(UINT, n, _MAX)
#define  __INTN_C(n, v) __stdint_join3( INT, n, _C(v))
#define __UINTN_C(n, v) __stdint_join3(UINT, n, _C(v))

/* C99 7.18.2.4 Limits of integer types capable of holding object pointers. */
/* C99 7.18.3 Limits of other integer types. */

#define  INTPTR_MIN  (-__INTPTR_MAX__-1)
#define  INTPTR_MAX    __INTPTR_MAX__
#define UINTPTR_MAX   __UINTPTR_MAX__
#define PTRDIFF_MIN (-__PTRDIFF_MAX__-1)
#define PTRDIFF_MAX   __PTRDIFF_MAX__
#define    SIZE_MAX      __SIZE_MAX__

/* C23 7.22.2.4 Width of integer types capable of holding object pointers. */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
/* NB: The C standard requires that these be the same value, but the compiler
   exposes separate internal width macros. */
#define INTPTR_WIDTH  __INTPTR_WIDTH__
#define UINTPTR_WIDTH __UINTPTR_WIDTH__
#endif

/* ISO9899:2011 7.20 (C11 Annex K): Define RSIZE_MAX if __STDC_WANT_LIB_EXT1__
 * is enabled. */
#if defined(__STDC_WANT_LIB_EXT1__) && __STDC_WANT_LIB_EXT1__ >= 1
#define   RSIZE_MAX            (SIZE_MAX >> 1)
#endif

/* C99 7.18.2.5 Limits of greatest-width integer types. */
#define  INTMAX_MIN (-__INTMAX_MAX__-1)
#define  INTMAX_MAX   __INTMAX_MAX__
#define UINTMAX_MAX  __UINTMAX_MAX__

/* C23 7.22.2.5 Width of greatest-width integer types. */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
/* NB: The C standard requires that these be the same value, but the compiler
   exposes separate internal width macros. */
#define INTMAX_WIDTH __INTMAX_WIDTH__
#define UINTMAX_WIDTH __UINTMAX_WIDTH__
#endif

/* C99 7.18.3 Limits of other integer types. */
#define SIG_ATOMIC_MIN __INTN_MIN(__SIG_ATOMIC_WIDTH__)
#define SIG_ATOMIC_MAX __INTN_MAX(__SIG_ATOMIC_WIDTH__)
#ifdef __WINT_UNSIGNED__
# define WINT_MIN       __UINTN_C(__WINT_WIDTH__, 0)
# define WINT_MAX       __UINTN_MAX(__WINT_WIDTH__)
#else
# define WINT_MIN       __INTN_MIN(__WINT_WIDTH__)
# define WINT_MAX       __INTN_MAX(__WINT_WIDTH__)
#endif

#ifndef WCHAR_MAX
# define WCHAR_MAX __WCHAR_MAX__
#endif
#ifndef WCHAR_MIN
# if __WCHAR_MAX__ == __INTN_MAX(__WCHAR_WIDTH__)
#  define WCHAR_MIN __INTN_MIN(__WCHAR_WIDTH__)
# else
#  define WCHAR_MIN __UINTN_C(__WCHAR_WIDTH__, 0)
# endif
#endif

/* 7.18.4.2 Macros for greatest-width integer constants. */
#define  INTMAX_C(v) __INTMAX_C(v)
#define UINTMAX_C(v) __UINTMAX_C(v)

/* C23 7.22.3.x Width of other integer types. */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define PTRDIFF_WIDTH    __PTRDIFF_WIDTH__
#define SIG_ATOMIC_WIDTH __SIG_ATOMIC_WIDTH__
#define SIZE_WIDTH       __SIZE_WIDTH__
#define WCHAR_WIDTH      __WCHAR_WIDTH__
#define WINT_WIDTH       __WINT_WIDTH__
#endif

#endif /* __STDC_HOSTED__ */
#endif /* __MVS__ */
#endif /* __CLANG_STDINT_H */
`,"stdnoreturn.h":`/*===---- stdnoreturn.h - Standard header for noreturn macro ---------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDNORETURN_H
#define __STDNORETURN_H

#if defined(__MVS__) && __has_include_next(<stdnoreturn.h>)
#include_next <stdnoreturn.h>
#else

#define noreturn _Noreturn
#define __noreturn_is_defined 1

#endif /* __MVS__ */

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ > 201710L) &&               \\
    !defined(_CLANG_DISABLE_CRT_DEPRECATION_WARNINGS)
/* The noreturn macro is deprecated in C23. We do not mark it as such because
   including the header file in C23 is also deprecated and we do not want to
   issue a confusing diagnostic for code which includes <stdnoreturn.h>
   followed by code that writes [[noreturn]]. The issue with such code is not
   with the attribute, or the use of 'noreturn', but the inclusion of the
   header. */
/* FIXME: We should be issuing a deprecation warning here, but cannot yet due
 * to system headers which include this header file unconditionally.
 */
#endif

#endif /* __STDNORETURN_H */
`,"tgmath.h":`/*===---- tgmath.h - Standard header for type generic math ----------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_TGMATH_H
#define __CLANG_TGMATH_H

/* C99 7.22 Type-generic math <tgmath.h>. */
#include <math.h>

/*
 * Allow additional definitions and implementation-defined values on Apple
 * platforms. This is done after #include <math.h> to avoid depcycle conflicts
 * between libcxx and darwin in C++ modules builds.
 */
#if defined(__APPLE__) && __STDC_HOSTED__ && __has_include_next(<tgmath.h>)
#  include_next <tgmath.h>
#else

/* C++ handles type genericity with overloading in math.h. */
#ifndef __cplusplus
#include <complex.h>

#define _TG_ATTRSp __attribute__((__overloadable__))
#define _TG_ATTRS __attribute__((__overloadable__, __always_inline__))

// promotion

typedef void _Argument_type_is_not_arithmetic;
static _Argument_type_is_not_arithmetic __tg_promote(...)
  __attribute__((__unavailable__,__overloadable__));
static double               _TG_ATTRSp __tg_promote(int);
static double               _TG_ATTRSp __tg_promote(unsigned int);
static double               _TG_ATTRSp __tg_promote(long);
static double               _TG_ATTRSp __tg_promote(unsigned long);
static double               _TG_ATTRSp __tg_promote(long long);
static double               _TG_ATTRSp __tg_promote(unsigned long long);
static float                _TG_ATTRSp __tg_promote(float);
static double               _TG_ATTRSp __tg_promote(double);
static long double          _TG_ATTRSp __tg_promote(long double);
static float _Complex       _TG_ATTRSp __tg_promote(float _Complex);
static double _Complex      _TG_ATTRSp __tg_promote(double _Complex);
static long double _Complex _TG_ATTRSp __tg_promote(long double _Complex);

#define __tg_promote1(__x)           (__typeof__(__tg_promote(__x)))
#define __tg_promote2(__x, __y)      (__typeof__(__tg_promote(__x) + \\
                                                 __tg_promote(__y)))
#define __tg_promote3(__x, __y, __z) (__typeof__(__tg_promote(__x) + \\
                                                 __tg_promote(__y) + \\
                                                 __tg_promote(__z)))

// acos

static float
    _TG_ATTRS
    __tg_acos(float __x) {return acosf(__x);}

static double
    _TG_ATTRS
    __tg_acos(double __x) {return acos(__x);}

static long double
    _TG_ATTRS
    __tg_acos(long double __x) {return acosl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_acos(float _Complex __x) {return cacosf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_acos(double _Complex __x) {return cacos(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_acos(long double _Complex __x) {return cacosl(__x);}

#undef acos
#define acos(__x) __tg_acos(__tg_promote1((__x))(__x))

// asin

static float
    _TG_ATTRS
    __tg_asin(float __x) {return asinf(__x);}

static double
    _TG_ATTRS
    __tg_asin(double __x) {return asin(__x);}

static long double
    _TG_ATTRS
    __tg_asin(long double __x) {return asinl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_asin(float _Complex __x) {return casinf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_asin(double _Complex __x) {return casin(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_asin(long double _Complex __x) {return casinl(__x);}

#undef asin
#define asin(__x) __tg_asin(__tg_promote1((__x))(__x))

// atan

static float
    _TG_ATTRS
    __tg_atan(float __x) {return atanf(__x);}

static double
    _TG_ATTRS
    __tg_atan(double __x) {return atan(__x);}

static long double
    _TG_ATTRS
    __tg_atan(long double __x) {return atanl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_atan(float _Complex __x) {return catanf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_atan(double _Complex __x) {return catan(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_atan(long double _Complex __x) {return catanl(__x);}

#undef atan
#define atan(__x) __tg_atan(__tg_promote1((__x))(__x))

// acosh

static float
    _TG_ATTRS
    __tg_acosh(float __x) {return acoshf(__x);}

static double
    _TG_ATTRS
    __tg_acosh(double __x) {return acosh(__x);}

static long double
    _TG_ATTRS
    __tg_acosh(long double __x) {return acoshl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_acosh(float _Complex __x) {return cacoshf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_acosh(double _Complex __x) {return cacosh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_acosh(long double _Complex __x) {return cacoshl(__x);}

#undef acosh
#define acosh(__x) __tg_acosh(__tg_promote1((__x))(__x))

// asinh

static float
    _TG_ATTRS
    __tg_asinh(float __x) {return asinhf(__x);}

static double
    _TG_ATTRS
    __tg_asinh(double __x) {return asinh(__x);}

static long double
    _TG_ATTRS
    __tg_asinh(long double __x) {return asinhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_asinh(float _Complex __x) {return casinhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_asinh(double _Complex __x) {return casinh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_asinh(long double _Complex __x) {return casinhl(__x);}

#undef asinh
#define asinh(__x) __tg_asinh(__tg_promote1((__x))(__x))

// atanh

static float
    _TG_ATTRS
    __tg_atanh(float __x) {return atanhf(__x);}

static double
    _TG_ATTRS
    __tg_atanh(double __x) {return atanh(__x);}

static long double
    _TG_ATTRS
    __tg_atanh(long double __x) {return atanhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_atanh(float _Complex __x) {return catanhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_atanh(double _Complex __x) {return catanh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_atanh(long double _Complex __x) {return catanhl(__x);}

#undef atanh
#define atanh(__x) __tg_atanh(__tg_promote1((__x))(__x))

// cos

static float
    _TG_ATTRS
    __tg_cos(float __x) {return cosf(__x);}

static double
    _TG_ATTRS
    __tg_cos(double __x) {return cos(__x);}

static long double
    _TG_ATTRS
    __tg_cos(long double __x) {return cosl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_cos(float _Complex __x) {return ccosf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cos(double _Complex __x) {return ccos(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cos(long double _Complex __x) {return ccosl(__x);}

#undef cos
#define cos(__x) __tg_cos(__tg_promote1((__x))(__x))

// sin

static float
    _TG_ATTRS
    __tg_sin(float __x) {return sinf(__x);}

static double
    _TG_ATTRS
    __tg_sin(double __x) {return sin(__x);}

static long double
    _TG_ATTRS
    __tg_sin(long double __x) {return sinl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_sin(float _Complex __x) {return csinf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_sin(double _Complex __x) {return csin(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_sin(long double _Complex __x) {return csinl(__x);}

#undef sin
#define sin(__x) __tg_sin(__tg_promote1((__x))(__x))

// tan

static float
    _TG_ATTRS
    __tg_tan(float __x) {return tanf(__x);}

static double
    _TG_ATTRS
    __tg_tan(double __x) {return tan(__x);}

static long double
    _TG_ATTRS
    __tg_tan(long double __x) {return tanl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_tan(float _Complex __x) {return ctanf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_tan(double _Complex __x) {return ctan(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_tan(long double _Complex __x) {return ctanl(__x);}

#undef tan
#define tan(__x) __tg_tan(__tg_promote1((__x))(__x))

// cosh

static float
    _TG_ATTRS
    __tg_cosh(float __x) {return coshf(__x);}

static double
    _TG_ATTRS
    __tg_cosh(double __x) {return cosh(__x);}

static long double
    _TG_ATTRS
    __tg_cosh(long double __x) {return coshl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_cosh(float _Complex __x) {return ccoshf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cosh(double _Complex __x) {return ccosh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cosh(long double _Complex __x) {return ccoshl(__x);}

#undef cosh
#define cosh(__x) __tg_cosh(__tg_promote1((__x))(__x))

// sinh

static float
    _TG_ATTRS
    __tg_sinh(float __x) {return sinhf(__x);}

static double
    _TG_ATTRS
    __tg_sinh(double __x) {return sinh(__x);}

static long double
    _TG_ATTRS
    __tg_sinh(long double __x) {return sinhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_sinh(float _Complex __x) {return csinhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_sinh(double _Complex __x) {return csinh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_sinh(long double _Complex __x) {return csinhl(__x);}

#undef sinh
#define sinh(__x) __tg_sinh(__tg_promote1((__x))(__x))

// tanh

static float
    _TG_ATTRS
    __tg_tanh(float __x) {return tanhf(__x);}

static double
    _TG_ATTRS
    __tg_tanh(double __x) {return tanh(__x);}

static long double
    _TG_ATTRS
    __tg_tanh(long double __x) {return tanhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_tanh(float _Complex __x) {return ctanhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_tanh(double _Complex __x) {return ctanh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_tanh(long double _Complex __x) {return ctanhl(__x);}

#undef tanh
#define tanh(__x) __tg_tanh(__tg_promote1((__x))(__x))

// exp

static float
    _TG_ATTRS
    __tg_exp(float __x) {return expf(__x);}

static double
    _TG_ATTRS
    __tg_exp(double __x) {return exp(__x);}

static long double
    _TG_ATTRS
    __tg_exp(long double __x) {return expl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_exp(float _Complex __x) {return cexpf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_exp(double _Complex __x) {return cexp(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_exp(long double _Complex __x) {return cexpl(__x);}

#undef exp
#define exp(__x) __tg_exp(__tg_promote1((__x))(__x))

// log

static float
    _TG_ATTRS
    __tg_log(float __x) {return logf(__x);}

static double
    _TG_ATTRS
    __tg_log(double __x) {return log(__x);}

static long double
    _TG_ATTRS
    __tg_log(long double __x) {return logl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_log(float _Complex __x) {return clogf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_log(double _Complex __x) {return clog(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_log(long double _Complex __x) {return clogl(__x);}

#undef log
#define log(__x) __tg_log(__tg_promote1((__x))(__x))

// pow

static float
    _TG_ATTRS
    __tg_pow(float __x, float __y) {return powf(__x, __y);}

static double
    _TG_ATTRS
    __tg_pow(double __x, double __y) {return pow(__x, __y);}

static long double
    _TG_ATTRS
    __tg_pow(long double __x, long double __y) {return powl(__x, __y);}

static float _Complex
    _TG_ATTRS
    __tg_pow(float _Complex __x, float _Complex __y) {return cpowf(__x, __y);}

static double _Complex
    _TG_ATTRS
    __tg_pow(double _Complex __x, double _Complex __y) {return cpow(__x, __y);}

static long double _Complex
    _TG_ATTRS
    __tg_pow(long double _Complex __x, long double _Complex __y)
    {return cpowl(__x, __y);}

#undef pow
#define pow(__x, __y) __tg_pow(__tg_promote2((__x), (__y))(__x), \\
                               __tg_promote2((__x), (__y))(__y))

// sqrt

static float
    _TG_ATTRS
    __tg_sqrt(float __x) {return sqrtf(__x);}

static double
    _TG_ATTRS
    __tg_sqrt(double __x) {return sqrt(__x);}

static long double
    _TG_ATTRS
    __tg_sqrt(long double __x) {return sqrtl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_sqrt(float _Complex __x) {return csqrtf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_sqrt(double _Complex __x) {return csqrt(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_sqrt(long double _Complex __x) {return csqrtl(__x);}

#undef sqrt
#define sqrt(__x) __tg_sqrt(__tg_promote1((__x))(__x))

// fabs

static float
    _TG_ATTRS
    __tg_fabs(float __x) {return fabsf(__x);}

static double
    _TG_ATTRS
    __tg_fabs(double __x) {return fabs(__x);}

static long double
    _TG_ATTRS
    __tg_fabs(long double __x) {return fabsl(__x);}

static float
    _TG_ATTRS
    __tg_fabs(float _Complex __x) {return cabsf(__x);}

static double
    _TG_ATTRS
    __tg_fabs(double _Complex __x) {return cabs(__x);}

static long double
    _TG_ATTRS
    __tg_fabs(long double _Complex __x) {return cabsl(__x);}

#undef fabs
#define fabs(__x) __tg_fabs(__tg_promote1((__x))(__x))

// atan2

static float
    _TG_ATTRS
    __tg_atan2(float __x, float __y) {return atan2f(__x, __y);}

static double
    _TG_ATTRS
    __tg_atan2(double __x, double __y) {return atan2(__x, __y);}

static long double
    _TG_ATTRS
    __tg_atan2(long double __x, long double __y) {return atan2l(__x, __y);}

#undef atan2
#define atan2(__x, __y) __tg_atan2(__tg_promote2((__x), (__y))(__x), \\
                                   __tg_promote2((__x), (__y))(__y))

// cbrt

static float
    _TG_ATTRS
    __tg_cbrt(float __x) {return cbrtf(__x);}

static double
    _TG_ATTRS
    __tg_cbrt(double __x) {return cbrt(__x);}

static long double
    _TG_ATTRS
    __tg_cbrt(long double __x) {return cbrtl(__x);}

#undef cbrt
#define cbrt(__x) __tg_cbrt(__tg_promote1((__x))(__x))

// ceil

static float
    _TG_ATTRS
    __tg_ceil(float __x) {return ceilf(__x);}

static double
    _TG_ATTRS
    __tg_ceil(double __x) {return ceil(__x);}

static long double
    _TG_ATTRS
    __tg_ceil(long double __x) {return ceill(__x);}

#undef ceil
#define ceil(__x) __tg_ceil(__tg_promote1((__x))(__x))

// copysign

static float
    _TG_ATTRS
    __tg_copysign(float __x, float __y) {return copysignf(__x, __y);}

static double
    _TG_ATTRS
    __tg_copysign(double __x, double __y) {return copysign(__x, __y);}

static long double
    _TG_ATTRS
    __tg_copysign(long double __x, long double __y) {return copysignl(__x, __y);}

#undef copysign
#define copysign(__x, __y) __tg_copysign(__tg_promote2((__x), (__y))(__x), \\
                                         __tg_promote2((__x), (__y))(__y))

// erf

static float
    _TG_ATTRS
    __tg_erf(float __x) {return erff(__x);}

static double
    _TG_ATTRS
    __tg_erf(double __x) {return erf(__x);}

static long double
    _TG_ATTRS
    __tg_erf(long double __x) {return erfl(__x);}

#undef erf
#define erf(__x) __tg_erf(__tg_promote1((__x))(__x))

// erfc

static float
    _TG_ATTRS
    __tg_erfc(float __x) {return erfcf(__x);}

static double
    _TG_ATTRS
    __tg_erfc(double __x) {return erfc(__x);}

static long double
    _TG_ATTRS
    __tg_erfc(long double __x) {return erfcl(__x);}

#undef erfc
#define erfc(__x) __tg_erfc(__tg_promote1((__x))(__x))

// exp2

static float
    _TG_ATTRS
    __tg_exp2(float __x) {return exp2f(__x);}

static double
    _TG_ATTRS
    __tg_exp2(double __x) {return exp2(__x);}

static long double
    _TG_ATTRS
    __tg_exp2(long double __x) {return exp2l(__x);}

#undef exp2
#define exp2(__x) __tg_exp2(__tg_promote1((__x))(__x))

// expm1

static float
    _TG_ATTRS
    __tg_expm1(float __x) {return expm1f(__x);}

static double
    _TG_ATTRS
    __tg_expm1(double __x) {return expm1(__x);}

static long double
    _TG_ATTRS
    __tg_expm1(long double __x) {return expm1l(__x);}

#undef expm1
#define expm1(__x) __tg_expm1(__tg_promote1((__x))(__x))

// fdim

static float
    _TG_ATTRS
    __tg_fdim(float __x, float __y) {return fdimf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fdim(double __x, double __y) {return fdim(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fdim(long double __x, long double __y) {return fdiml(__x, __y);}

#undef fdim
#define fdim(__x, __y) __tg_fdim(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// floor

static float
    _TG_ATTRS
    __tg_floor(float __x) {return floorf(__x);}

static double
    _TG_ATTRS
    __tg_floor(double __x) {return floor(__x);}

static long double
    _TG_ATTRS
    __tg_floor(long double __x) {return floorl(__x);}

#undef floor
#define floor(__x) __tg_floor(__tg_promote1((__x))(__x))

// fma

static float
    _TG_ATTRS
    __tg_fma(float __x, float __y, float __z)
    {return fmaf(__x, __y, __z);}

static double
    _TG_ATTRS
    __tg_fma(double __x, double __y, double __z)
    {return fma(__x, __y, __z);}

static long double
    _TG_ATTRS
    __tg_fma(long double __x,long double __y, long double __z)
    {return fmal(__x, __y, __z);}

#undef fma
#define fma(__x, __y, __z)                                \\
        __tg_fma(__tg_promote3((__x), (__y), (__z))(__x), \\
                 __tg_promote3((__x), (__y), (__z))(__y), \\
                 __tg_promote3((__x), (__y), (__z))(__z))

// fmax

static float
    _TG_ATTRS
    __tg_fmax(float __x, float __y) {return fmaxf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fmax(double __x, double __y) {return fmax(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fmax(long double __x, long double __y) {return fmaxl(__x, __y);}

#undef fmax
#define fmax(__x, __y) __tg_fmax(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// fmin

static float
    _TG_ATTRS
    __tg_fmin(float __x, float __y) {return fminf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fmin(double __x, double __y) {return fmin(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fmin(long double __x, long double __y) {return fminl(__x, __y);}

#undef fmin
#define fmin(__x, __y) __tg_fmin(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// fmod

static float
    _TG_ATTRS
    __tg_fmod(float __x, float __y) {return fmodf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fmod(double __x, double __y) {return fmod(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fmod(long double __x, long double __y) {return fmodl(__x, __y);}

#undef fmod
#define fmod(__x, __y) __tg_fmod(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// frexp

static float
    _TG_ATTRS
    __tg_frexp(float __x, int* __y) {return frexpf(__x, __y);}

static double
    _TG_ATTRS
    __tg_frexp(double __x, int* __y) {return frexp(__x, __y);}

static long double
    _TG_ATTRS
    __tg_frexp(long double __x, int* __y) {return frexpl(__x, __y);}

#undef frexp
#define frexp(__x, __y) __tg_frexp(__tg_promote1((__x))(__x), __y)

// hypot

static float
    _TG_ATTRS
    __tg_hypot(float __x, float __y) {return hypotf(__x, __y);}

static double
    _TG_ATTRS
    __tg_hypot(double __x, double __y) {return hypot(__x, __y);}

static long double
    _TG_ATTRS
    __tg_hypot(long double __x, long double __y) {return hypotl(__x, __y);}

#undef hypot
#define hypot(__x, __y) __tg_hypot(__tg_promote2((__x), (__y))(__x), \\
                                   __tg_promote2((__x), (__y))(__y))

// ilogb

static int
    _TG_ATTRS
    __tg_ilogb(float __x) {return ilogbf(__x);}

static int
    _TG_ATTRS
    __tg_ilogb(double __x) {return ilogb(__x);}

static int
    _TG_ATTRS
    __tg_ilogb(long double __x) {return ilogbl(__x);}

#undef ilogb
#define ilogb(__x) __tg_ilogb(__tg_promote1((__x))(__x))

// ldexp

static float
    _TG_ATTRS
    __tg_ldexp(float __x, int __y) {return ldexpf(__x, __y);}

static double
    _TG_ATTRS
    __tg_ldexp(double __x, int __y) {return ldexp(__x, __y);}

static long double
    _TG_ATTRS
    __tg_ldexp(long double __x, int __y) {return ldexpl(__x, __y);}

#undef ldexp
#define ldexp(__x, __y) __tg_ldexp(__tg_promote1((__x))(__x), __y)

// lgamma

static float
    _TG_ATTRS
    __tg_lgamma(float __x) {return lgammaf(__x);}

static double
    _TG_ATTRS
    __tg_lgamma(double __x) {return lgamma(__x);}

static long double
    _TG_ATTRS
    __tg_lgamma(long double __x) {return lgammal(__x);}

#undef lgamma
#define lgamma(__x) __tg_lgamma(__tg_promote1((__x))(__x))

// llrint

static long long
    _TG_ATTRS
    __tg_llrint(float __x) {return llrintf(__x);}

static long long
    _TG_ATTRS
    __tg_llrint(double __x) {return llrint(__x);}

static long long
    _TG_ATTRS
    __tg_llrint(long double __x) {return llrintl(__x);}

#undef llrint
#define llrint(__x) __tg_llrint(__tg_promote1((__x))(__x))

// llround

static long long
    _TG_ATTRS
    __tg_llround(float __x) {return llroundf(__x);}

static long long
    _TG_ATTRS
    __tg_llround(double __x) {return llround(__x);}

static long long
    _TG_ATTRS
    __tg_llround(long double __x) {return llroundl(__x);}

#undef llround
#define llround(__x) __tg_llround(__tg_promote1((__x))(__x))

// log10

static float
    _TG_ATTRS
    __tg_log10(float __x) {return log10f(__x);}

static double
    _TG_ATTRS
    __tg_log10(double __x) {return log10(__x);}

static long double
    _TG_ATTRS
    __tg_log10(long double __x) {return log10l(__x);}

#undef log10
#define log10(__x) __tg_log10(__tg_promote1((__x))(__x))

// log1p

static float
    _TG_ATTRS
    __tg_log1p(float __x) {return log1pf(__x);}

static double
    _TG_ATTRS
    __tg_log1p(double __x) {return log1p(__x);}

static long double
    _TG_ATTRS
    __tg_log1p(long double __x) {return log1pl(__x);}

#undef log1p
#define log1p(__x) __tg_log1p(__tg_promote1((__x))(__x))

// log2

static float
    _TG_ATTRS
    __tg_log2(float __x) {return log2f(__x);}

static double
    _TG_ATTRS
    __tg_log2(double __x) {return log2(__x);}

static long double
    _TG_ATTRS
    __tg_log2(long double __x) {return log2l(__x);}

#undef log2
#define log2(__x) __tg_log2(__tg_promote1((__x))(__x))

// logb

static float
    _TG_ATTRS
    __tg_logb(float __x) {return logbf(__x);}

static double
    _TG_ATTRS
    __tg_logb(double __x) {return logb(__x);}

static long double
    _TG_ATTRS
    __tg_logb(long double __x) {return logbl(__x);}

#undef logb
#define logb(__x) __tg_logb(__tg_promote1((__x))(__x))

// lrint

static long
    _TG_ATTRS
    __tg_lrint(float __x) {return lrintf(__x);}

static long
    _TG_ATTRS
    __tg_lrint(double __x) {return lrint(__x);}

static long
    _TG_ATTRS
    __tg_lrint(long double __x) {return lrintl(__x);}

#undef lrint
#define lrint(__x) __tg_lrint(__tg_promote1((__x))(__x))

// lround

static long
    _TG_ATTRS
    __tg_lround(float __x) {return lroundf(__x);}

static long
    _TG_ATTRS
    __tg_lround(double __x) {return lround(__x);}

static long
    _TG_ATTRS
    __tg_lround(long double __x) {return lroundl(__x);}

#undef lround
#define lround(__x) __tg_lround(__tg_promote1((__x))(__x))

// nearbyint

static float
    _TG_ATTRS
    __tg_nearbyint(float __x) {return nearbyintf(__x);}

static double
    _TG_ATTRS
    __tg_nearbyint(double __x) {return nearbyint(__x);}

static long double
    _TG_ATTRS
    __tg_nearbyint(long double __x) {return nearbyintl(__x);}

#undef nearbyint
#define nearbyint(__x) __tg_nearbyint(__tg_promote1((__x))(__x))

// nextafter

static float
    _TG_ATTRS
    __tg_nextafter(float __x, float __y) {return nextafterf(__x, __y);}

static double
    _TG_ATTRS
    __tg_nextafter(double __x, double __y) {return nextafter(__x, __y);}

static long double
    _TG_ATTRS
    __tg_nextafter(long double __x, long double __y) {return nextafterl(__x, __y);}

#undef nextafter
#define nextafter(__x, __y) __tg_nextafter(__tg_promote2((__x), (__y))(__x), \\
                                           __tg_promote2((__x), (__y))(__y))

// nexttoward

static float
    _TG_ATTRS
    __tg_nexttoward(float __x, long double __y) {return nexttowardf(__x, __y);}

static double
    _TG_ATTRS
    __tg_nexttoward(double __x, long double __y) {return nexttoward(__x, __y);}

static long double
    _TG_ATTRS
    __tg_nexttoward(long double __x, long double __y) {return nexttowardl(__x, __y);}

#undef nexttoward
#define nexttoward(__x, __y) __tg_nexttoward(__tg_promote1((__x))(__x), (__y))

// remainder

static float
    _TG_ATTRS
    __tg_remainder(float __x, float __y) {return remainderf(__x, __y);}

static double
    _TG_ATTRS
    __tg_remainder(double __x, double __y) {return remainder(__x, __y);}

static long double
    _TG_ATTRS
    __tg_remainder(long double __x, long double __y) {return remainderl(__x, __y);}

#undef remainder
#define remainder(__x, __y) __tg_remainder(__tg_promote2((__x), (__y))(__x), \\
                                           __tg_promote2((__x), (__y))(__y))

// remquo

static float
    _TG_ATTRS
    __tg_remquo(float __x, float __y, int* __z)
    {return remquof(__x, __y, __z);}

static double
    _TG_ATTRS
    __tg_remquo(double __x, double __y, int* __z)
    {return remquo(__x, __y, __z);}

static long double
    _TG_ATTRS
    __tg_remquo(long double __x,long double __y, int* __z)
    {return remquol(__x, __y, __z);}

#undef remquo
#define remquo(__x, __y, __z)                         \\
        __tg_remquo(__tg_promote2((__x), (__y))(__x), \\
                    __tg_promote2((__x), (__y))(__y), \\
                    (__z))

// rint

static float
    _TG_ATTRS
    __tg_rint(float __x) {return rintf(__x);}

static double
    _TG_ATTRS
    __tg_rint(double __x) {return rint(__x);}

static long double
    _TG_ATTRS
    __tg_rint(long double __x) {return rintl(__x);}

#undef rint
#define rint(__x) __tg_rint(__tg_promote1((__x))(__x))

// round

static float
    _TG_ATTRS
    __tg_round(float __x) {return roundf(__x);}

static double
    _TG_ATTRS
    __tg_round(double __x) {return round(__x);}

static long double
    _TG_ATTRS
    __tg_round(long double __x) {return roundl(__x);}

#undef round
#define round(__x) __tg_round(__tg_promote1((__x))(__x))

// scalbn

static float
    _TG_ATTRS
    __tg_scalbn(float __x, int __y) {return scalbnf(__x, __y);}

static double
    _TG_ATTRS
    __tg_scalbn(double __x, int __y) {return scalbn(__x, __y);}

static long double
    _TG_ATTRS
    __tg_scalbn(long double __x, int __y) {return scalbnl(__x, __y);}

#undef scalbn
#define scalbn(__x, __y) __tg_scalbn(__tg_promote1((__x))(__x), __y)

// scalbln

static float
    _TG_ATTRS
    __tg_scalbln(float __x, long __y) {return scalblnf(__x, __y);}

static double
    _TG_ATTRS
    __tg_scalbln(double __x, long __y) {return scalbln(__x, __y);}

static long double
    _TG_ATTRS
    __tg_scalbln(long double __x, long __y) {return scalblnl(__x, __y);}

#undef scalbln
#define scalbln(__x, __y) __tg_scalbln(__tg_promote1((__x))(__x), __y)

// tgamma

static float
    _TG_ATTRS
    __tg_tgamma(float __x) {return tgammaf(__x);}

static double
    _TG_ATTRS
    __tg_tgamma(double __x) {return tgamma(__x);}

static long double
    _TG_ATTRS
    __tg_tgamma(long double __x) {return tgammal(__x);}

#undef tgamma
#define tgamma(__x) __tg_tgamma(__tg_promote1((__x))(__x))

// trunc

static float
    _TG_ATTRS
    __tg_trunc(float __x) {return truncf(__x);}

static double
    _TG_ATTRS
    __tg_trunc(double __x) {return trunc(__x);}

static long double
    _TG_ATTRS
    __tg_trunc(long double __x) {return truncl(__x);}

#undef trunc
#define trunc(__x) __tg_trunc(__tg_promote1((__x))(__x))

// carg

static float
    _TG_ATTRS
    __tg_carg(float __x) {return atan2f(0.F, __x);}

static double
    _TG_ATTRS
    __tg_carg(double __x) {return atan2(0., __x);}

static long double
    _TG_ATTRS
    __tg_carg(long double __x) {return atan2l(0.L, __x);}

static float
    _TG_ATTRS
    __tg_carg(float _Complex __x) {return cargf(__x);}

static double
    _TG_ATTRS
    __tg_carg(double _Complex __x) {return carg(__x);}

static long double
    _TG_ATTRS
    __tg_carg(long double _Complex __x) {return cargl(__x);}

#undef carg
#define carg(__x) __tg_carg(__tg_promote1((__x))(__x))

// cimag

static float
    _TG_ATTRS
    __tg_cimag(float __x) {return 0;}

static double
    _TG_ATTRS
    __tg_cimag(double __x) {return 0;}

static long double
    _TG_ATTRS
    __tg_cimag(long double __x) {return 0;}

static float
    _TG_ATTRS
    __tg_cimag(float _Complex __x) {return cimagf(__x);}

static double
    _TG_ATTRS
    __tg_cimag(double _Complex __x) {return cimag(__x);}

static long double
    _TG_ATTRS
    __tg_cimag(long double _Complex __x) {return cimagl(__x);}

#undef cimag
#define cimag(__x) __tg_cimag(__tg_promote1((__x))(__x))

// conj

static float _Complex
    _TG_ATTRS
    __tg_conj(float __x) {return __x;}

static double _Complex
    _TG_ATTRS
    __tg_conj(double __x) {return __x;}

static long double _Complex
    _TG_ATTRS
    __tg_conj(long double __x) {return __x;}

static float _Complex
    _TG_ATTRS
    __tg_conj(float _Complex __x) {return conjf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_conj(double _Complex __x) {return conj(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_conj(long double _Complex __x) {return conjl(__x);}

#undef conj
#define conj(__x) __tg_conj(__tg_promote1((__x))(__x))

// cproj

static float _Complex
    _TG_ATTRS
    __tg_cproj(float __x) {return cprojf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cproj(double __x) {return cproj(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cproj(long double __x) {return cprojl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_cproj(float _Complex __x) {return cprojf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cproj(double _Complex __x) {return cproj(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cproj(long double _Complex __x) {return cprojl(__x);}

#undef cproj
#define cproj(__x) __tg_cproj(__tg_promote1((__x))(__x))

// creal

static float
    _TG_ATTRS
    __tg_creal(float __x) {return __x;}

static double
    _TG_ATTRS
    __tg_creal(double __x) {return __x;}

static long double
    _TG_ATTRS
    __tg_creal(long double __x) {return __x;}

static float
    _TG_ATTRS
    __tg_creal(float _Complex __x) {return crealf(__x);}

static double
    _TG_ATTRS
    __tg_creal(double _Complex __x) {return creal(__x);}

static long double
    _TG_ATTRS
    __tg_creal(long double _Complex __x) {return creall(__x);}

#undef creal
#define creal(__x) __tg_creal(__tg_promote1((__x))(__x))

#undef _TG_ATTRSp
#undef _TG_ATTRS

#endif /* __cplusplus */
#endif /* __has_include_next */
#endif /* __CLANG_TGMATH_H */
`,"unwind.h":`/*===---- unwind.h - Stack unwinding ----------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/* See "Data Definitions for libgcc_s" in the Linux Standard Base.*/

#ifndef __CLANG_UNWIND_H
#define __CLANG_UNWIND_H

#if defined(__APPLE__) && __has_include_next(<unwind.h>)
/* Darwin (from 11.x on) provide an unwind.h. If that's available,
 * use it. libunwind wraps some of its definitions in #ifdef _GNU_SOURCE,
 * so define that around the include.*/
# ifndef _GNU_SOURCE
#  define _SHOULD_UNDEFINE_GNU_SOURCE
#  define _GNU_SOURCE
# endif
// libunwind's unwind.h reflects the current visibility.  However, Mozilla
// builds with -fvisibility=hidden and relies on gcc's unwind.h to reset the
// visibility to default and export its contents.  gcc also allows users to
// override its override by #defining HIDE_EXPORTS (but note, this only obeys
// the user's -fvisibility setting; it doesn't hide any exports on its own).  We
// imitate gcc's header here:
# ifdef HIDE_EXPORTS
#  include_next <unwind.h>
# else
#  pragma GCC visibility push(default)
#  include_next <unwind.h>
#  pragma GCC visibility pop
# endif
# ifdef _SHOULD_UNDEFINE_GNU_SOURCE
#  undef _GNU_SOURCE
#  undef _SHOULD_UNDEFINE_GNU_SOURCE
# endif
#else

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* It is a bit strange for a header to play with the visibility of the
   symbols it declares, but this matches gcc's behavior and some programs
   depend on it */
#ifndef HIDE_EXPORTS
#pragma GCC visibility push(default)
#endif

typedef uintptr_t _Unwind_Word __attribute__((__mode__(__unwind_word__)));
typedef intptr_t _Unwind_Sword __attribute__((__mode__(__unwind_word__)));
typedef uintptr_t _Unwind_Ptr;
typedef uintptr_t _Unwind_Internal_Ptr;
typedef uint64_t _Unwind_Exception_Class;

typedef intptr_t _sleb128_t;
typedef uintptr_t _uleb128_t;

struct _Unwind_Context;
#if defined(__arm__) && !(defined(__USING_SJLJ_EXCEPTIONS__) || \\
                          defined(__ARM_DWARF_EH__) || defined(__SEH__))
struct _Unwind_Control_Block;
typedef struct _Unwind_Control_Block _Unwind_Control_Block;
#define _Unwind_Exception _Unwind_Control_Block /* Alias */
#else
struct _Unwind_Exception;
typedef struct _Unwind_Exception _Unwind_Exception;
#endif
typedef enum {
  _URC_NO_REASON = 0,
#if defined(__arm__) && !defined(__USING_SJLJ_EXCEPTIONS__) && \\
    !defined(__ARM_DWARF_EH__) && !defined(__SEH__)
  _URC_OK = 0, /* used by ARM EHABI */
#endif
  _URC_FOREIGN_EXCEPTION_CAUGHT = 1,

  _URC_FATAL_PHASE2_ERROR = 2,
  _URC_FATAL_PHASE1_ERROR = 3,
  _URC_NORMAL_STOP = 4,

  _URC_END_OF_STACK = 5,
  _URC_HANDLER_FOUND = 6,
  _URC_INSTALL_CONTEXT = 7,
  _URC_CONTINUE_UNWIND = 8,
#if defined(__arm__) && !defined(__USING_SJLJ_EXCEPTIONS__) && \\
    !defined(__ARM_DWARF_EH__) && !defined(__SEH__)
  _URC_FAILURE = 9 /* used by ARM EHABI */
#endif
} _Unwind_Reason_Code;

typedef enum {
  _UA_SEARCH_PHASE = 1,
  _UA_CLEANUP_PHASE = 2,

  _UA_HANDLER_FRAME = 4,
  _UA_FORCE_UNWIND = 8,
  _UA_END_OF_STACK = 16 /* gcc extension to C++ ABI */
} _Unwind_Action;

typedef void (*_Unwind_Exception_Cleanup_Fn)(_Unwind_Reason_Code,
                                             _Unwind_Exception *);

#if defined(__arm__) && !(defined(__USING_SJLJ_EXCEPTIONS__) || \\
                          defined(__ARM_DWARF_EH__) || defined(__SEH__))
typedef struct _Unwind_Control_Block _Unwind_Control_Block;
typedef uint32_t _Unwind_EHT_Header;

struct _Unwind_Control_Block {
  uint64_t exception_class;
  void (*exception_cleanup)(_Unwind_Reason_Code, _Unwind_Control_Block *);
  /* unwinder cache (private fields for the unwinder's use) */
  struct {
    uint32_t reserved1; /* forced unwind stop function, 0 if not forced */
    uint32_t reserved2; /* personality routine */
    uint32_t reserved3; /* callsite */
    uint32_t reserved4; /* forced unwind stop argument */
    uint32_t reserved5;
  } unwinder_cache;
  /* propagation barrier cache (valid after phase 1) */
  struct {
    uint32_t sp;
    uint32_t bitpattern[5];
  } barrier_cache;
  /* cleanup cache (preserved over cleanup) */
  struct {
    uint32_t bitpattern[4];
  } cleanup_cache;
  /* personality cache (for personality's benefit) */
  struct {
    uint32_t fnstart;         /* function start address */
    _Unwind_EHT_Header *ehtp; /* pointer to EHT entry header word */
    uint32_t additional;      /* additional data */
    uint32_t reserved1;
  } pr_cache;
  long long int : 0; /* force alignment of next item to 8-byte boundary */
} __attribute__((__aligned__(8)));
#else
struct _Unwind_Exception {
  _Unwind_Exception_Class exception_class;
  _Unwind_Exception_Cleanup_Fn exception_cleanup;
#if !defined (__USING_SJLJ_EXCEPTIONS__) && defined (__SEH__)
  _Unwind_Word private_[6];
#else
  _Unwind_Word private_1;
  _Unwind_Word private_2;
#endif
  /* The Itanium ABI requires that _Unwind_Exception objects are "double-word
   * aligned".  GCC has interpreted this to mean "use the maximum useful
   * alignment for the target"; so do we. */
} __attribute__((__aligned__));
#endif

typedef _Unwind_Reason_Code (*_Unwind_Stop_Fn)(int, _Unwind_Action,
                                               _Unwind_Exception_Class,
                                               _Unwind_Exception *,
                                               struct _Unwind_Context *,
                                               void *);

typedef _Unwind_Reason_Code (*_Unwind_Personality_Fn)(int, _Unwind_Action,
                                                      _Unwind_Exception_Class,
                                                      _Unwind_Exception *,
                                                      struct _Unwind_Context *);
typedef _Unwind_Personality_Fn __personality_routine;

typedef _Unwind_Reason_Code (*_Unwind_Trace_Fn)(struct _Unwind_Context *,
                                                void *);

#if defined(__arm__) && !(defined(__USING_SJLJ_EXCEPTIONS__) ||                \\
                          defined(__ARM_DWARF_EH__) || defined(__SEH__))
typedef enum {
  _UVRSC_CORE = 0,        /* integer register */
  _UVRSC_VFP = 1,         /* vfp */
  _UVRSC_WMMXD = 3,       /* Intel WMMX data register */
  _UVRSC_WMMXC = 4,       /* Intel WMMX control register */
  _UVRSC_PSEUDO = 5       /* Special purpose pseudo register */
} _Unwind_VRS_RegClass;

typedef enum {
  _UVRSD_UINT32 = 0,
  _UVRSD_VFPX = 1,
  _UVRSD_UINT64 = 3,
  _UVRSD_FLOAT = 4,
  _UVRSD_DOUBLE = 5
} _Unwind_VRS_DataRepresentation;

typedef enum {
  _UVRSR_OK = 0,
  _UVRSR_NOT_IMPLEMENTED = 1,
  _UVRSR_FAILED = 2
} _Unwind_VRS_Result;

typedef uint32_t _Unwind_State;
#define _US_VIRTUAL_UNWIND_FRAME  ((_Unwind_State)0)
#define _US_UNWIND_FRAME_STARTING ((_Unwind_State)1)
#define _US_UNWIND_FRAME_RESUME   ((_Unwind_State)2)
#define _US_ACTION_MASK           ((_Unwind_State)3)
#define _US_FORCE_UNWIND          ((_Unwind_State)8)

_Unwind_VRS_Result _Unwind_VRS_Get(struct _Unwind_Context *__context,
  _Unwind_VRS_RegClass __regclass,
  uint32_t __regno,
  _Unwind_VRS_DataRepresentation __representation,
  void *__valuep);

_Unwind_VRS_Result _Unwind_VRS_Set(struct _Unwind_Context *__context,
  _Unwind_VRS_RegClass __regclass,
  uint32_t __regno,
  _Unwind_VRS_DataRepresentation __representation,
  void *__valuep);

static __inline__
_Unwind_Word _Unwind_GetGR(struct _Unwind_Context *__context, int __index) {
  _Unwind_Word __value;
  _Unwind_VRS_Get(__context, _UVRSC_CORE, __index, _UVRSD_UINT32, &__value);
  return __value;
}

static __inline__
void _Unwind_SetGR(struct _Unwind_Context *__context, int __index,
                   _Unwind_Word __value) {
  _Unwind_VRS_Set(__context, _UVRSC_CORE, __index, _UVRSD_UINT32, &__value);
}

static __inline__
_Unwind_Word _Unwind_GetIP(struct _Unwind_Context *__context) {
  _Unwind_Word __ip = _Unwind_GetGR(__context, 15);
  return __ip & ~(_Unwind_Word)(0x1); /* Remove thumb mode bit. */
}

static __inline__
void _Unwind_SetIP(struct _Unwind_Context *__context, _Unwind_Word __value) {
  _Unwind_Word __thumb_mode_bit = _Unwind_GetGR(__context, 15) & 0x1;
  _Unwind_SetGR(__context, 15, __value | __thumb_mode_bit);
}
#else
_Unwind_Word _Unwind_GetGR(struct _Unwind_Context *, int);
void _Unwind_SetGR(struct _Unwind_Context *, int, _Unwind_Word);

_Unwind_Word _Unwind_GetIP(struct _Unwind_Context *);
void _Unwind_SetIP(struct _Unwind_Context *, _Unwind_Word);
#endif


_Unwind_Word _Unwind_GetIPInfo(struct _Unwind_Context *, int *);

_Unwind_Word _Unwind_GetCFA(struct _Unwind_Context *);

_Unwind_Word _Unwind_GetBSP(struct _Unwind_Context *);

void *_Unwind_GetLanguageSpecificData(struct _Unwind_Context *);

_Unwind_Ptr _Unwind_GetRegionStart(struct _Unwind_Context *);

/* DWARF EH functions; currently not available on Darwin/ARM */
#if !defined(__APPLE__) || !defined(__arm__)
_Unwind_Reason_Code _Unwind_RaiseException(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_ForcedUnwind(_Unwind_Exception *, _Unwind_Stop_Fn,
                                         void *);
void _Unwind_DeleteException(_Unwind_Exception *);
void _Unwind_Resume(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_Resume_or_Rethrow(_Unwind_Exception *);

#endif

_Unwind_Reason_Code _Unwind_Backtrace(_Unwind_Trace_Fn, void *);

/* setjmp(3)/longjmp(3) stuff */
typedef struct SjLj_Function_Context *_Unwind_FunctionContext_t;

void _Unwind_SjLj_Register(_Unwind_FunctionContext_t);
void _Unwind_SjLj_Unregister(_Unwind_FunctionContext_t);
_Unwind_Reason_Code _Unwind_SjLj_RaiseException(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_SjLj_ForcedUnwind(_Unwind_Exception *,
                                              _Unwind_Stop_Fn, void *);
void _Unwind_SjLj_Resume(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_SjLj_Resume_or_Rethrow(_Unwind_Exception *);

void *_Unwind_FindEnclosingFunction(void *);

#ifdef __APPLE__

_Unwind_Ptr _Unwind_GetDataRelBase(struct _Unwind_Context *)
    __attribute__((__unavailable__));
_Unwind_Ptr _Unwind_GetTextRelBase(struct _Unwind_Context *)
    __attribute__((__unavailable__));

/* Darwin-specific functions */
void __register_frame(const void *);
void __deregister_frame(const void *);

struct dwarf_eh_bases {
  uintptr_t tbase;
  uintptr_t dbase;
  uintptr_t func;
};
void *_Unwind_Find_FDE(const void *, struct dwarf_eh_bases *);

void __register_frame_info_bases(const void *, void *, void *, void *)
  __attribute__((__unavailable__));
void __register_frame_info(const void *, void *) __attribute__((__unavailable__));
void __register_frame_info_table_bases(const void *, void*, void *, void *)
  __attribute__((__unavailable__));
void __register_frame_info_table(const void *, void *)
  __attribute__((__unavailable__));
void __register_frame_table(const void *) __attribute__((__unavailable__));
void __deregister_frame_info(const void *) __attribute__((__unavailable__));
void __deregister_frame_info_bases(const void *)__attribute__((__unavailable__));

#else

_Unwind_Ptr _Unwind_GetDataRelBase(struct _Unwind_Context *);
_Unwind_Ptr _Unwind_GetTextRelBase(struct _Unwind_Context *);

#endif


#ifndef HIDE_EXPORTS
#pragma GCC visibility pop
#endif

#ifdef __cplusplus
}
#endif

#endif

#endif /* __CLANG_UNWIND_H */
`,"varargs.h":`/*===---- varargs.h - Variable argument handling -------------------------------------===
*
* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
* See https://llvm.org/LICENSE.txt for license information.
* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
*
*===-----------------------------------------------------------------------===
*/
#ifndef __VARARGS_H
#define __VARARGS_H
#if defined(__MVS__) && __has_include_next(<varargs.h>)
#include_next <varargs.h>
#else
#error "Please use <stdarg.h> instead of <varargs.h>"
#endif /* __MVS__ */
#endif
`}),Y=Object.freeze({name:`clang`,version:`22.1.8`,revision:`ca7933e47d3a3451d81e72ac174dcb5aa28b59d1`});function Ne(e,t,n){if(t?.name!==Y.name||t.version!==Y.version||t.revision!==Y.revision||n!==`/lib/clang/22`)return!1;let r=new TextDecoder(`utf-8`,{fatal:!0}),i=[];for(let[a,o]of Object.entries(Me)){let s=`${n}/include/${a}`;try{let n=e.readFile(s);if(n!==null){if(r.decode(n)!==o)throw Error(`Clang ${t.version} resource header differs from its pinned source: ${a}`)}else i.push([s,o])}catch(e){throw Error(`Unable to inspect Clang ${t.version} resource header ${a}: ${e instanceof Error?e.message:String(e)}`,{cause:e})}}if(i.length)try{e.mkdirTree(`${n}/include`)}catch(e){throw Error(`Unable to prepare Clang ${t.version} resource header directory: ${e instanceof Error?e.message:String(e)}`,{cause:e})}let a=new TextEncoder;for(let[n,r]of i)try{e.writeFile(n,a.encode(r))}catch(e){throw Error(`Unable to install Clang ${t.version} resource header ${n.slice(n.lastIndexOf(`/`)+1)}: ${e instanceof Error?e.message:String(e)}`,{cause:e})}return!0}const X=[`-fobjc-runtime=gnustep-2.0`,`-fblocks`],Pe=[`-DOBJC2RUNTIME=1`];function Fe(e){return(e||``).trim().toUpperCase().replaceAll(/\s+/g,``)}function Ie(e){switch(Fe(e)){case`03`:case`CPP03`:case`C++03`:case`GNU++03`:case`GNUC++03`:return`-std=gnu++03`;case`11`:case`CPP11`:case`C++11`:case`GNU++11`:case`GNUC++11`:return`-std=gnu++11`;case`14`:case`CPP14`:case`C++14`:case`GNU++14`:case`GNUC++14`:return`-std=gnu++14`;case`17`:case`CPP17`:case`C++17`:case`GNU++17`:case`GNUC++17`:return`-std=gnu++17`;case`20`:case`CPP20`:case`C++20`:case`GNU++20`:case`GNUC++20`:return`-std=gnu++20`;case`23`:case`CPP23`:case`C++23`:case`GNU++23`:case`GNUC++23`:return`-std=gnu++23`;case`26`:case`CPP26`:case`C++26`:case`GNU++26`:case`GNUC++26`:return`-std=gnu++26`;default:return`-std=gnu++20`}}function Le(e){switch(Fe(e)){case`99`:case`C99`:case`GNU99`:case`GNUC99`:return`-std=gnu99`;case`11`:case`C11`:case`GNU11`:case`GNUC11`:return`-std=gnu11`;case`17`:case`18`:case`C17`:case`C18`:case`GNU17`:case`GNU18`:case`GNUC17`:case`GNUC18`:return`-std=gnu17`;default:return`-std=gnu11`}}function Re(e,t){return e===`C`?{languageArg:`c`,standardArg:Le(t.cVersion)}:e===`OBJC`?{languageArg:`objective-c`,standardArg:Le(t.cVersion)}:{languageArg:`c++`,standardArg:Ie(t.cppVersion)}}function ze(e,t=``,n){return[...[`CPP`,`OBJCXX`].includes(e)?[`${t}/include/c++/v1`,`${t}/include/wasm32-wasi/c++/v1`]:[],...n?[`${n.replace(/\/+$/,``)}/include`]:[],`${t}/include/wasm32-wasi`,`${t}/include`]}const Z=`/workspace`;`${Z}`;const Be=`${Z}/main.cpp`;`${Be}`;const Ve=e=>e.endsWith(`/`)?e.slice(0,-1):e,He=(e=`CPP`,t={})=>{let n=Re(e,t);return[n.standardArg,`-x`,n.languageArg,`--target=wasm32-wasi`,...t.resourceDir?[`-resource-dir`,t.resourceDir]:[],...ze(e,`/usr`,t.resourceDir).map(e=>`-isystem${e}`),...e===`OBJC`?[...X.flatMap(e=>e.startsWith(`-fobjc-runtime=`)?[`-Xclang`,e]:[e]),...Pe,`-I/objc`,`-I/objc/objc`]:[]]},Ue=(e={})=>[`C`,`CPP`,`OBJC`].map(t=>JSON.stringify({If:{PathMatch:{C:`.*\\.c`,CPP:`.*\\.(cc|cpp|cxx|h|hh|hpp|hxx)`,OBJC:`.*\\.m`}[t]},CompileFlags:{Add:He(t,e)}})).join(`
---
`);var We=class{chunks=[];chunkIndex=0;offset=0;readable=!1;waiters=[];get hasBytes(){return this.chunkIndex<this.chunks.length}push(e){if(e.byteLength){this.chunks.push(e);for(let e of this.waiters.splice(0))e()}}read(){if(!this.readable)return null;let e=this.chunks[this.chunkIndex];if(!e)return null;let t=e[this.offset++];return this.offset===e.length&&(this.readable=!1,this.offset=0,this.chunkIndex++,this.chunkIndex===this.chunks.length?(this.chunks=[],this.chunkIndex=0):this.chunkIndex>=64&&(this.chunks=this.chunks.slice(this.chunkIndex),this.chunkIndex=0)),t}async ready(){this.hasBytes||await new Promise(e=>this.waiters.push(e)),this.readable=!0}};const Ge=new TextEncoder,Ke=`${Z}/`;function qe(e){let t=F(e.startsWith(Ke)?e.slice(Ke.length):e),n=Ge.encode(t).byteLength;if(n>M.maxPathBytes)throw new j(`path-size-limit`,`Clangd workspace path ${t} is ${n} bytes; limit is ${M.maxPathBytes}`,{path:t,limit:M.maxPathBytes,actual:n});return`${Ke}${t}`}var Je=class{maxFiles;paths=new Set([Be]);constructor(e=M.maxFiles){if(this.maxFiles=e,!Number.isSafeInteger(e)||e<1)throw new j(`invalid-limit`,`Clangd workspace file limit must be a positive safe integer`)}register(e){let t=qe(e);if(this.paths.has(t))return{path:t,added:!1};let n=this.paths.size+1;if(n>this.maxFiles)throw new j(`file-count-limit`,`Clangd workspace contains ${n} files; limit is ${this.maxFiles}`,{limit:this.maxFiles,actual:n});return this.paths.add(t),{path:t,added:!0}}unregister(e){e!==Be&&this.paths.delete(e)}};const Ye=new TextEncoder,Xe=new TextDecoder,Ze=new G,Qe=new We;let $e=!1,et=``;const tt=e=>{let t=e;return!t||typeof t!=`object`?typeof e:typeof t.method==`string`?t.method:t.id===void 0?`unknown`:`response:${String(t.id)}`},nt=e=>{let t=e;return!!t&&typeof t==`object`&&t.jsonrpc===`2.0`},Q=(...e)=>{$e&&console.debug(`[wasm-idle:clangd-worker]`,...e)},rt=()=>Qe.read(),it=()=>Qe.ready();let at=null,$=null;const ot=new Je,st=e=>{let t=Ze.insert(e);if(!t||!at)return;let n=JSON.parse(t);Q(`stdout`,tt(n)),at.write(n)},ct=e=>{if($e){if(e===10||e===13){et&&Q(`stderr`,et),et=``;return}et+=String.fromCharCode(e)}},lt=()=>{at?.end(),self.reportError?.(`clangd aborted`)},ut=e=>{let t=qe(e);if(!$)return;let n=ot.register(t),r=n.path.lastIndexOf(`/`),i=r>0?n.path.slice(0,r):Z;try{$.FS.mkdirTree(i),$.FS.writeFile(n.path,``)}catch(e){throw n.added&&ot.unregister(n.path),e}};self.addEventListener(`message`,async e=>{if(e.data?.type===`sync-file`){try{if(typeof e.data.name!=`string`)throw TypeError(`clangd sync-file name must be a string`);ut(e.data.name)}catch(e){self.postMessage({type:`error`,message:`Failed to sync clangd workspace file: ${e instanceof Error?e.message:String(e)}`})}return}if(e.data?.type===`init`){$e=!!e.data.debug;try{if(typeof e.data.baseUrl!=`string`||!e.data.baseUrl.trim())throw Error(`clangd init requires an explicit baseUrl`);if(Q(`init`,Ve(e.data.baseUrl.trim())+`/`),!e.data.assets)throw Error(`clangd init requires preloaded runtime assets`);let t=new Uint8Array(e.data.assets.clangdJs);self.postMessage({type:`progress`,stage:`module-loading`,value:1,max:3});let n=Xe.decode(t),r=URL.createObjectURL(new Blob([n],{type:`text/javascript;charset=utf-8`})),i=new Uint8Array(e.data.assets.clangdWasmGz);self.postMessage({type:`progress`,stage:`decompression`,value:2,max:3});let a=await je(i,`clangd.wasm.gz`);e.data.assets.clangdWasmIntegrity&&await D({asset:`clangd.wasm.gz`,bytes:a,expected:e.data.assets.clangdWasmIntegrity,stage:`uncompressed`,mimeType:`application/wasm`,runtimeId:`clangd`}),self.postMessage({type:`progress`,stage:`wasm-initialization`,value:3,max:3});let o=import(r),s=new Uint8Array(a.byteLength);s.set(a);let c=new Blob([s.buffer],{type:`application/wasm`}),l=URL.createObjectURL(c),{default:u}=await o;$=await u({thisProgram:`/usr/bin/clangd`,mainScriptUrlOrBlob:r,locateFile:(e,t)=>e.endsWith(`.wasm`)?l:`${t}${e}`,stdinReady:it,stdin:rt,stdout:st,stderr:ct,onExit:lt,onAbort:lt}),$.FS.mkdirTree(Z),ke($.FS,`/usr`);let d=e.data.assets.clangdWasmIntegrity?.uncompressedSha256===`0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019`?`/lib/clang/22`:void 0;d&&Ne({readFile:e=>$.FS.analyzePath(e).exists?$.FS.readFile(e):null,mkdirTree:e=>$.FS.mkdirTree(e),writeFile:(e,t)=>$.FS.writeFile(e,t)},Y,d),ut(Be),$.FS.writeFile(`${Z}/.clangd`,Ue({...e.data.compileProfile,resourceDir:d}));for(let[t,n]of Object.entries(e.data.assets.objectiveCHeaders||{})){if(!t||t.startsWith(`/`)||t.split(`/`).some(e=>!e||e===`..`||e===`.`)||/[\\\x00-\x1f]/u.test(t)||typeof n!=`string`)throw Error(`Invalid Objective-C header path or contents`);let e=`/objc/${t}`;$.FS.mkdirTree(e.slice(0,e.lastIndexOf(`/`))),$.FS.writeFile(e,n)}Q(`callMain start`),Q(`callMain returned`,$.callMain([])),at=new S(self),new x(self).listen(e=>{if(!nt(e)){Q(`ignored control message`,tt(e));return}Q(`stdin message`,tt(e));let t=JSON.stringify(e).replace(/[\u007F-\uFFFF]/g,e=>`\\u`+e.codePointAt(0)?.toString(16).padStart(4,`0`)),n=Ye.encode(t).byteLength;Qe.push(Ye.encode(`Content-Length: ${n}\r\n\r\n${t}`)),Q(`stdin queued bytes`,n)}),self.postMessage({type:`ready`,value:a.byteLength})}catch(e){self.postMessage({type:`error`,message:e instanceof Error?e.message:String(e)})}}});