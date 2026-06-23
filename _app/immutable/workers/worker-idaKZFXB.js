var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n)),l=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.stringArray=e.array=e.func=e.error=e.number=e.string=e.boolean=void 0;function t(e){return e===!0||e===!1}e.boolean=t;function n(e){return typeof e==`string`||e instanceof String}e.string=n;function r(e){return typeof e==`number`||e instanceof Number}e.number=r;function i(e){return e instanceof Error}e.error=i;function a(e){return typeof e==`function`}e.func=a;function o(e){return Array.isArray(e)}e.array=o;function s(e){return o(e)&&e.every(e=>n(e))}e.stringArray=s})),u=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Message=e.NotificationType9=e.NotificationType8=e.NotificationType7=e.NotificationType6=e.NotificationType5=e.NotificationType4=e.NotificationType3=e.NotificationType2=e.NotificationType1=e.NotificationType0=e.NotificationType=e.RequestType9=e.RequestType8=e.RequestType7=e.RequestType6=e.RequestType5=e.RequestType4=e.RequestType3=e.RequestType2=e.RequestType1=e.RequestType=e.RequestType0=e.AbstractMessageSignature=e.ParameterStructures=e.ResponseError=e.ErrorCodes=void 0;let t=l();var n;(function(e){e.ParseError=-32700,e.InvalidRequest=-32600,e.MethodNotFound=-32601,e.InvalidParams=-32602,e.InternalError=-32603,e.jsonrpcReservedErrorRangeStart=-32099,e.serverErrorStart=-32099,e.MessageWriteError=-32099,e.MessageReadError=-32098,e.PendingResponseRejected=-32097,e.ConnectionInactive=-32096,e.ServerNotInitialized=-32002,e.UnknownErrorCode=-32001,e.jsonrpcReservedErrorRangeEnd=-32e3,e.serverErrorEnd=-32e3})(n||(e.ErrorCodes=n={})),e.ResponseError=class e extends Error{constructor(r,i,a){super(i),this.code=t.number(r)?r:n.UnknownErrorCode,this.data=a,Object.setPrototypeOf(this,e.prototype)}toJson(){let e={code:this.code,message:this.message};return this.data!==void 0&&(e.data=this.data),e}};var r=class e{constructor(e){this.kind=e}static is(t){return t===e.auto||t===e.byName||t===e.byPosition}toString(){return this.kind}};e.ParameterStructures=r,r.auto=new r(`auto`),r.byPosition=new r(`byPosition`),r.byName=new r(`byName`);var i=class{constructor(e,t){this.method=e,this.numberOfParams=t}get parameterStructures(){return r.auto}};e.AbstractMessageSignature=i,e.RequestType0=class extends i{constructor(e){super(e,0)}},e.RequestType=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.RequestType1=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.RequestType2=class extends i{constructor(e){super(e,2)}},e.RequestType3=class extends i{constructor(e){super(e,3)}},e.RequestType4=class extends i{constructor(e){super(e,4)}},e.RequestType5=class extends i{constructor(e){super(e,5)}},e.RequestType6=class extends i{constructor(e){super(e,6)}},e.RequestType7=class extends i{constructor(e){super(e,7)}},e.RequestType8=class extends i{constructor(e){super(e,8)}},e.RequestType9=class extends i{constructor(e){super(e,9)}},e.NotificationType=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.NotificationType0=class extends i{constructor(e){super(e,0)}},e.NotificationType1=class extends i{constructor(e,t=r.auto){super(e,1),this._parameterStructures=t}get parameterStructures(){return this._parameterStructures}},e.NotificationType2=class extends i{constructor(e){super(e,2)}},e.NotificationType3=class extends i{constructor(e){super(e,3)}},e.NotificationType4=class extends i{constructor(e){super(e,4)}},e.NotificationType5=class extends i{constructor(e){super(e,5)}},e.NotificationType6=class extends i{constructor(e){super(e,6)}},e.NotificationType7=class extends i{constructor(e){super(e,7)}},e.NotificationType8=class extends i{constructor(e){super(e,8)}},e.NotificationType9=class extends i{constructor(e){super(e,9)}};var a;(function(e){function n(e){let n=e;return n&&t.string(n.method)&&(t.string(n.id)||t.number(n.id))}e.isRequest=n;function r(e){let n=e;return n&&t.string(n.method)&&e.id===void 0}e.isNotification=r;function i(e){let n=e;return n&&(n.result!==void 0||!!n.error)&&(t.string(n.id)||t.number(n.id)||n.id===null)}e.isResponse=i})(a||(e.Message=a={}))})),d=o((e=>{var t;Object.defineProperty(e,`__esModule`,{value:!0}),e.LRUCache=e.LinkedMap=e.Touch=void 0;var n;(function(e){e.None=0,e.First=1,e.AsOld=e.First,e.Last=2,e.AsNew=e.Last})(n||(e.Touch=n={}));var r=class{constructor(){this[t]=`LinkedMap`,this._map=new Map,this._head=void 0,this._tail=void 0,this._size=0,this._state=0}clear(){this._map.clear(),this._head=void 0,this._tail=void 0,this._size=0,this._state++}isEmpty(){return!this._head&&!this._tail}get size(){return this._size}get first(){return this._head?.value}get last(){return this._tail?.value}has(e){return this._map.has(e)}get(e,t=n.None){let r=this._map.get(e);if(r)return t!==n.None&&this.touch(r,t),r.value}set(e,t,r=n.None){let i=this._map.get(e);if(i)i.value=t,r!==n.None&&this.touch(i,r);else{switch(i={key:e,value:t,next:void 0,previous:void 0},r){case n.None:this.addItemLast(i);break;case n.First:this.addItemFirst(i);break;case n.Last:this.addItemLast(i);break;default:this.addItemLast(i);break}this._map.set(e,i),this._size++}return this}delete(e){return!!this.remove(e)}remove(e){let t=this._map.get(e);if(t)return this._map.delete(e),this.removeItem(t),this._size--,t.value}shift(){if(!this._head&&!this._tail)return;if(!this._head||!this._tail)throw Error(`Invalid list`);let e=this._head;return this._map.delete(e.key),this.removeItem(e),this._size--,e.value}forEach(e,t){let n=this._state,r=this._head;for(;r;){if(t?e.bind(t)(r.value,r.key,this):e(r.value,r.key,this),this._state!==n)throw Error(`LinkedMap got modified during iteration.`);r=r.next}}keys(){let e=this._state,t=this._head,n={[Symbol.iterator]:()=>n,next:()=>{if(this._state!==e)throw Error(`LinkedMap got modified during iteration.`);if(t){let e={value:t.key,done:!1};return t=t.next,e}else return{value:void 0,done:!0}}};return n}values(){let e=this._state,t=this._head,n={[Symbol.iterator]:()=>n,next:()=>{if(this._state!==e)throw Error(`LinkedMap got modified during iteration.`);if(t){let e={value:t.value,done:!1};return t=t.next,e}else return{value:void 0,done:!0}}};return n}entries(){let e=this._state,t=this._head,n={[Symbol.iterator]:()=>n,next:()=>{if(this._state!==e)throw Error(`LinkedMap got modified during iteration.`);if(t){let e={value:[t.key,t.value],done:!1};return t=t.next,e}else return{value:void 0,done:!0}}};return n}[(t=Symbol.toStringTag,Symbol.iterator)](){return this.entries()}trimOld(e){if(e>=this.size)return;if(e===0){this.clear();return}let t=this._head,n=this.size;for(;t&&n>e;)this._map.delete(t.key),t=t.next,n--;this._head=t,this._size=n,t&&(t.previous=void 0),this._state++}addItemFirst(e){if(!this._head&&!this._tail)this._tail=e;else if(this._head)e.next=this._head,this._head.previous=e;else throw Error(`Invalid list`);this._head=e,this._state++}addItemLast(e){if(!this._head&&!this._tail)this._head=e;else if(this._tail)e.previous=this._tail,this._tail.next=e;else throw Error(`Invalid list`);this._tail=e,this._state++}removeItem(e){if(e===this._head&&e===this._tail)this._head=void 0,this._tail=void 0;else if(e===this._head){if(!e.next)throw Error(`Invalid list`);e.next.previous=void 0,this._head=e.next}else if(e===this._tail){if(!e.previous)throw Error(`Invalid list`);e.previous.next=void 0,this._tail=e.previous}else{let t=e.next,n=e.previous;if(!t||!n)throw Error(`Invalid list`);t.previous=n,n.next=t}e.next=void 0,e.previous=void 0,this._state++}touch(e,t){if(!this._head||!this._tail)throw Error(`Invalid list`);if(!(t!==n.First&&t!==n.Last)){if(t===n.First){if(e===this._head)return;let t=e.next,n=e.previous;e===this._tail?(n.next=void 0,this._tail=n):(t.previous=n,n.next=t),e.previous=void 0,e.next=this._head,this._head.previous=e,this._head=e,this._state++}else if(t===n.Last){if(e===this._tail)return;let t=e.next,n=e.previous;e===this._head?(t.previous=void 0,this._head=t):(t.previous=n,n.next=t),e.next=void 0,e.previous=this._tail,this._tail.next=e,this._tail=e,this._state++}}}toJSON(){let e=[];return this.forEach((t,n)=>{e.push([n,t])}),e}fromJSON(e){this.clear();for(let[t,n]of e)this.set(t,n)}};e.LinkedMap=r,e.LRUCache=class extends r{constructor(e,t=1){super(),this._limit=e,this._ratio=Math.min(Math.max(0,t),1)}get limit(){return this._limit}set limit(e){this._limit=e,this.checkTrim()}get ratio(){return this._ratio}set ratio(e){this._ratio=Math.min(Math.max(0,e),1),this.checkTrim()}get(e,t=n.AsNew){return super.get(e,t)}peek(e){return super.get(e,n.None)}set(e,t){return super.set(e,t,n.Last),this.checkTrim(),this}checkTrim(){this.size>this._limit&&this.trimOld(Math.round(this._limit*this._ratio))}}})),f=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Disposable=void 0;var t;(function(e){function t(e){return{dispose:e}}e.create=t})(t||(e.Disposable=t={}))})),p=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0});let t;function n(){if(t===void 0)throw Error(`No runtime abstraction layer installed`);return t}(function(e){function n(e){if(e===void 0)throw Error(`No runtime abstraction layer provided`);t=e}e.install=n})(n||={}),e.default=n})),m=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Emitter=e.Event=void 0;let t=p();var n;(function(e){let t={dispose(){}};e.None=function(){return t}})(n||(e.Event=n={}));var r=class{add(e,t=null,n){this._callbacks||(this._callbacks=[],this._contexts=[]),this._callbacks.push(e),this._contexts.push(t),Array.isArray(n)&&n.push({dispose:()=>this.remove(e,t)})}remove(e,t=null){if(!this._callbacks)return;let n=!1;for(let r=0,i=this._callbacks.length;r<i;r++)if(this._callbacks[r]===e)if(this._contexts[r]===t){this._callbacks.splice(r,1),this._contexts.splice(r,1);return}else n=!0;if(n)throw Error(`When adding a listener with a context, you should remove it with the same context`)}invoke(...e){if(!this._callbacks)return[];let n=[],r=this._callbacks.slice(0),i=this._contexts.slice(0);for(let a=0,o=r.length;a<o;a++)try{n.push(r[a].apply(i[a],e))}catch(e){(0,t.default)().console.error(e)}return n}isEmpty(){return!this._callbacks||this._callbacks.length===0}dispose(){this._callbacks=void 0,this._contexts=void 0}},i=class e{constructor(e){this._options=e}get event(){return this._event||=(t,n,i)=>{this._callbacks||=new r,this._options&&this._options.onFirstListenerAdd&&this._callbacks.isEmpty()&&this._options.onFirstListenerAdd(this),this._callbacks.add(t,n);let a={dispose:()=>{this._callbacks&&(this._callbacks.remove(t,n),a.dispose=e._noop,this._options&&this._options.onLastListenerRemove&&this._callbacks.isEmpty()&&this._options.onLastListenerRemove(this))}};return Array.isArray(i)&&i.push(a),a},this._event}fire(e){this._callbacks&&this._callbacks.invoke.call(this._callbacks,e)}dispose(){this._callbacks&&=(this._callbacks.dispose(),void 0)}};e.Emitter=i,i._noop=function(){}})),ee=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.CancellationTokenSource=e.CancellationToken=void 0;let t=p(),n=l(),r=m();var i;(function(e){e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:r.Event.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:r.Event.None});function t(t){let r=t;return r&&(r===e.None||r===e.Cancelled||n.boolean(r.isCancellationRequested)&&!!r.onCancellationRequested)}e.is=t})(i||(e.CancellationToken=i={}));let a=Object.freeze(function(e,n){let r=(0,t.default)().timer.setTimeout(e.bind(n),0);return{dispose(){r.dispose()}}});var o=class{constructor(){this._isCancelled=!1}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?a:(this._emitter||=new r.Emitter,this._emitter.event)}dispose(){this._emitter&&=(this._emitter.dispose(),void 0)}};e.CancellationTokenSource=class{get token(){return this._token||=new o,this._token}cancel(){this._token?this._token.cancel():this._token=i.Cancelled}dispose(){this._token?this._token instanceof o&&this._token.dispose():this._token=i.None}}})),te=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.SharedArrayReceiverStrategy=e.SharedArraySenderStrategy=void 0;let t=ee();var n;(function(e){e.Continue=0,e.Cancelled=1})(n||={}),e.SharedArraySenderStrategy=class{constructor(){this.buffers=new Map}enableCancellation(e){if(e.id===null)return;let t=new SharedArrayBuffer(4),r=new Int32Array(t,0,1);r[0]=n.Continue,this.buffers.set(e.id,t),e.$cancellationData=t}async sendCancellation(e,t){let r=this.buffers.get(t);if(r===void 0)return;let i=new Int32Array(r,0,1);Atomics.store(i,0,n.Cancelled)}cleanup(e){this.buffers.delete(e)}dispose(){this.buffers.clear()}};var r=class{constructor(e){this.data=new Int32Array(e,0,1)}get isCancellationRequested(){return Atomics.load(this.data,0)===n.Cancelled}get onCancellationRequested(){throw Error(`Cancellation over SharedArrayBuffer doesn't support cancellation events`)}},i=class{constructor(e){this.token=new r(e)}cancel(){}dispose(){}};e.SharedArrayReceiverStrategy=class{constructor(){this.kind=`request`}createCancellationTokenSource(e){let n=e.$cancellationData;return n===void 0?new t.CancellationTokenSource:new i(n)}}})),h=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.Semaphore=void 0;let t=p();e.Semaphore=class{constructor(e=1){if(e<=0)throw Error(`Capacity must be greater than 0`);this._capacity=e,this._active=0,this._waiting=[]}lock(e){return new Promise((t,n)=>{this._waiting.push({thunk:e,resolve:t,reject:n}),this.runNext()})}get active(){return this._active}runNext(){this._waiting.length===0||this._active===this._capacity||(0,t.default)().timer.setImmediate(()=>this.doRunNext())}doRunNext(){if(this._waiting.length===0||this._active===this._capacity)return;let e=this._waiting.shift();if(this._active++,this._active>this._capacity)throw Error(`To many thunks active`);try{let t=e.thunk();t instanceof Promise?t.then(t=>{this._active--,e.resolve(t),this.runNext()},t=>{this._active--,e.reject(t),this.runNext()}):(this._active--,e.resolve(t),this.runNext())}catch(t){this._active--,e.reject(t),this.runNext()}}}})),ne=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.ReadableStreamMessageReader=e.AbstractMessageReader=e.MessageReader=void 0;let t=p(),n=l(),r=m(),i=h();var a;(function(e){function t(e){let t=e;return t&&n.func(t.listen)&&n.func(t.dispose)&&n.func(t.onError)&&n.func(t.onClose)&&n.func(t.onPartialMessage)}e.is=t})(a||(e.MessageReader=a={}));var o=class{constructor(){this.errorEmitter=new r.Emitter,this.closeEmitter=new r.Emitter,this.partialMessageEmitter=new r.Emitter}dispose(){this.errorEmitter.dispose(),this.closeEmitter.dispose()}get onError(){return this.errorEmitter.event}fireError(e){this.errorEmitter.fire(this.asError(e))}get onClose(){return this.closeEmitter.event}fireClose(){this.closeEmitter.fire(void 0)}get onPartialMessage(){return this.partialMessageEmitter.event}firePartialMessage(e){this.partialMessageEmitter.fire(e)}asError(e){return e instanceof Error?e:Error(`Reader received error. Reason: ${n.string(e.message)?e.message:`unknown`}`)}};e.AbstractMessageReader=o;var s;(function(e){function n(e){let n,r,i=new Map,a,o=new Map;if(e===void 0||typeof e==`string`)n=e??`utf-8`;else{if(n=e.charset??`utf-8`,e.contentDecoder!==void 0&&(r=e.contentDecoder,i.set(r.name,r)),e.contentDecoders!==void 0)for(let t of e.contentDecoders)i.set(t.name,t);if(e.contentTypeDecoder!==void 0&&(a=e.contentTypeDecoder,o.set(a.name,a)),e.contentTypeDecoders!==void 0)for(let t of e.contentTypeDecoders)o.set(t.name,t)}return a===void 0&&(a=(0,t.default)().applicationJson.decoder,o.set(a.name,a)),{charset:n,contentDecoder:r,contentDecoders:i,contentTypeDecoder:a,contentTypeDecoders:o}}e.fromOptions=n})(s||={}),e.ReadableStreamMessageReader=class extends o{constructor(e,n){super(),this.readable=e,this.options=s.fromOptions(n),this.buffer=(0,t.default)().messageBuffer.create(this.options.charset),this._partialMessageTimeout=1e4,this.nextMessageLength=-1,this.messageToken=0,this.readSemaphore=new i.Semaphore(1)}set partialMessageTimeout(e){this._partialMessageTimeout=e}get partialMessageTimeout(){return this._partialMessageTimeout}listen(e){this.nextMessageLength=-1,this.messageToken=0,this.partialMessageTimer=void 0,this.callback=e;let t=this.readable.onData(e=>{this.onData(e)});return this.readable.onError(e=>this.fireError(e)),this.readable.onClose(()=>this.fireClose()),t}onData(e){try{for(this.buffer.append(e);;){if(this.nextMessageLength===-1){let e=this.buffer.tryReadHeaders(!0);if(!e)return;let t=e.get(`content-length`);if(!t){this.fireError(Error(`Header must provide a Content-Length property.\n${JSON.stringify(Object.fromEntries(e))}`));return}let n=parseInt(t);if(isNaN(n)){this.fireError(Error(`Content-Length value must be a number. Got ${t}`));return}this.nextMessageLength=n}let e=this.buffer.tryReadBody(this.nextMessageLength);if(e===void 0){this.setPartialMessageTimer();return}this.clearPartialMessageTimer(),this.nextMessageLength=-1,this.readSemaphore.lock(async()=>{let t=this.options.contentDecoder===void 0?e:await this.options.contentDecoder.decode(e),n=await this.options.contentTypeDecoder.decode(t,this.options);this.callback(n)}).catch(e=>{this.fireError(e)})}}catch(e){this.fireError(e)}}clearPartialMessageTimer(){this.partialMessageTimer&&=(this.partialMessageTimer.dispose(),void 0)}setPartialMessageTimer(){this.clearPartialMessageTimer(),!(this._partialMessageTimeout<=0)&&(this.partialMessageTimer=(0,t.default)().timer.setTimeout((e,t)=>{this.partialMessageTimer=void 0,e===this.messageToken&&(this.firePartialMessage({messageToken:e,waitingTime:t}),this.setPartialMessageTimer())},this._partialMessageTimeout,this.messageToken,this._partialMessageTimeout))}}})),g=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.WriteableStreamMessageWriter=e.AbstractMessageWriter=e.MessageWriter=void 0;let t=p(),n=l(),r=h(),i=m();var a;(function(e){function t(e){let t=e;return t&&n.func(t.dispose)&&n.func(t.onClose)&&n.func(t.onError)&&n.func(t.write)}e.is=t})(a||(e.MessageWriter=a={}));var o=class{constructor(){this.errorEmitter=new i.Emitter,this.closeEmitter=new i.Emitter}dispose(){this.errorEmitter.dispose(),this.closeEmitter.dispose()}get onError(){return this.errorEmitter.event}fireError(e,t,n){this.errorEmitter.fire([this.asError(e),t,n])}get onClose(){return this.closeEmitter.event}fireClose(){this.closeEmitter.fire(void 0)}asError(e){return e instanceof Error?e:Error(`Writer received error. Reason: ${n.string(e.message)?e.message:`unknown`}`)}};e.AbstractMessageWriter=o;var s;(function(e){function n(e){return e===void 0||typeof e==`string`?{charset:e??`utf-8`,contentTypeEncoder:(0,t.default)().applicationJson.encoder}:{charset:e.charset??`utf-8`,contentEncoder:e.contentEncoder,contentTypeEncoder:e.contentTypeEncoder??(0,t.default)().applicationJson.encoder}}e.fromOptions=n})(s||={}),e.WriteableStreamMessageWriter=class extends o{constructor(e,t){super(),this.writable=e,this.options=s.fromOptions(t),this.errorCount=0,this.writeSemaphore=new r.Semaphore(1),this.writable.onError(e=>this.fireError(e)),this.writable.onClose(()=>this.fireClose())}async write(e){return this.writeSemaphore.lock(async()=>this.options.contentTypeEncoder.encode(e,this.options).then(e=>this.options.contentEncoder===void 0?e:this.options.contentEncoder.encode(e)).then(t=>{let n=[];return n.push(`Content-Length: `,t.byteLength.toString(),`\r
`),n.push(`\r
`),this.doWrite(e,n,t)},e=>{throw this.fireError(e),e}))}async doWrite(e,t,n){try{return await this.writable.write(t.join(``),`ascii`),this.writable.write(n)}catch(t){return this.handleError(t,e),Promise.reject(t)}}handleError(e,t){this.errorCount++,this.fireError(e,t,this.errorCount)}end(){this.writable.end()}}})),_=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.AbstractMessageBuffer=void 0,e.AbstractMessageBuffer=class{constructor(e=`utf-8`){this._encoding=e,this._chunks=[],this._totalLength=0}get encoding(){return this._encoding}append(e){let t=typeof e==`string`?this.fromString(e,this._encoding):e;this._chunks.push(t),this._totalLength+=t.byteLength}tryReadHeaders(e=!1){if(this._chunks.length===0)return;let t=0,n=0,r=0,i=0;row:for(;n<this._chunks.length;){let e=this._chunks[n];r=0;column:for(;r<e.length;){switch(e[r]){case 13:switch(t){case 0:t=1;break;case 2:t=3;break;default:t=0}break;case 10:switch(t){case 1:t=2;break;case 3:t=4,r++;break row;default:t=0}break;default:t=0}r++}i+=e.byteLength,n++}if(t!==4)return;let a=this._read(i+r),o=new Map,s=this.toString(a,`ascii`).split(`\r
`);if(s.length<2)return o;for(let t=0;t<s.length-2;t++){let n=s[t],r=n.indexOf(`:`);if(r===-1)throw Error(`Message header must separate key and value using ':'\n${n}`);let i=n.substr(0,r),a=n.substr(r+1).trim();o.set(e?i.toLowerCase():i,a)}return o}tryReadBody(e){if(!(this._totalLength<e))return this._read(e)}get numberOfBytes(){return this._totalLength}_read(e){if(e===0)return this.emptyBuffer();if(e>this._totalLength)throw Error(`Cannot read so many bytes!`);if(this._chunks[0].byteLength===e){let t=this._chunks[0];return this._chunks.shift(),this._totalLength-=e,this.asNative(t)}if(this._chunks[0].byteLength>e){let t=this._chunks[0],n=this.asNative(t,e);return this._chunks[0]=t.slice(e),this._totalLength-=e,n}let t=this.allocNative(e),n=0;for(;e>0;){let r=this._chunks[0];if(r.byteLength>e){let i=r.slice(0,e);t.set(i,n),n+=e,this._chunks[0]=r.slice(e),this._totalLength-=e,e-=e}else t.set(r,n),n+=r.byteLength,this._chunks.shift(),this._totalLength-=r.byteLength,e-=r.byteLength}return t}}})),v=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.createMessageConnection=e.ConnectionOptions=e.MessageStrategy=e.CancellationStrategy=e.CancellationSenderStrategy=e.CancellationReceiverStrategy=e.RequestCancellationReceiverStrategy=e.IdCancellationReceiverStrategy=e.ConnectionStrategy=e.ConnectionError=e.ConnectionErrors=e.LogTraceNotification=e.SetTraceNotification=e.TraceFormat=e.TraceValues=e.Trace=e.NullLogger=e.ProgressType=e.ProgressToken=void 0;let t=p(),n=l(),r=u(),i=d(),a=m(),o=ee();var s;(function(e){e.type=new r.NotificationType(`$/cancelRequest`)})(s||={});var c;(function(e){function t(e){return typeof e==`string`||typeof e==`number`}e.is=t})(c||(e.ProgressToken=c={}));var f;(function(e){e.type=new r.NotificationType(`$/progress`)})(f||={}),e.ProgressType=class{constructor(){}};var te;(function(e){function t(e){return n.func(e)}e.is=t})(te||={}),e.NullLogger=Object.freeze({error:()=>{},warn:()=>{},info:()=>{},log:()=>{}});var h;(function(e){e[e.Off=0]=`Off`,e[e.Messages=1]=`Messages`,e[e.Compact=2]=`Compact`,e[e.Verbose=3]=`Verbose`})(h||(e.Trace=h={}));var ne;(function(e){e.Off=`off`,e.Messages=`messages`,e.Compact=`compact`,e.Verbose=`verbose`})(ne||(e.TraceValues=ne={})),(function(e){function t(t){if(!n.string(t))return e.Off;switch(t=t.toLowerCase(),t){case`off`:return e.Off;case`messages`:return e.Messages;case`compact`:return e.Compact;case`verbose`:return e.Verbose;default:return e.Off}}e.fromString=t;function r(t){switch(t){case e.Off:return`off`;case e.Messages:return`messages`;case e.Compact:return`compact`;case e.Verbose:return`verbose`;default:return`off`}}e.toString=r})(h||(e.Trace=h={}));var g;(function(e){e.Text=`text`,e.JSON=`json`})(g||(e.TraceFormat=g={})),(function(e){function t(t){return n.string(t)?(t=t.toLowerCase(),t===`json`?e.JSON:e.Text):e.Text}e.fromString=t})(g||(e.TraceFormat=g={}));var _;(function(e){e.type=new r.NotificationType(`$/setTrace`)})(_||(e.SetTraceNotification=_={}));var v;(function(e){e.type=new r.NotificationType(`$/logTrace`)})(v||(e.LogTraceNotification=v={}));var y;(function(e){e[e.Closed=1]=`Closed`,e[e.Disposed=2]=`Disposed`,e[e.AlreadyListening=3]=`AlreadyListening`})(y||(e.ConnectionErrors=y={}));var b=class e extends Error{constructor(t,n){super(n),this.code=t,Object.setPrototypeOf(this,e.prototype)}};e.ConnectionError=b;var x;(function(e){function t(e){let t=e;return t&&n.func(t.cancelUndispatched)}e.is=t})(x||(e.ConnectionStrategy=x={}));var S;(function(e){function t(e){let t=e;return t&&(t.kind===void 0||t.kind===`id`)&&n.func(t.createCancellationTokenSource)&&(t.dispose===void 0||n.func(t.dispose))}e.is=t})(S||(e.IdCancellationReceiverStrategy=S={}));var C;(function(e){function t(e){let t=e;return t&&t.kind===`request`&&n.func(t.createCancellationTokenSource)&&(t.dispose===void 0||n.func(t.dispose))}e.is=t})(C||(e.RequestCancellationReceiverStrategy=C={}));var w;(function(e){e.Message=Object.freeze({createCancellationTokenSource(e){return new o.CancellationTokenSource}});function t(e){return S.is(e)||C.is(e)}e.is=t})(w||(e.CancellationReceiverStrategy=w={}));var T;(function(e){e.Message=Object.freeze({sendCancellation(e,t){return e.sendNotification(s.type,{id:t})},cleanup(e){}});function t(e){let t=e;return t&&n.func(t.sendCancellation)&&n.func(t.cleanup)}e.is=t})(T||(e.CancellationSenderStrategy=T={}));var E;(function(e){e.Message=Object.freeze({receiver:w.Message,sender:T.Message});function t(e){let t=e;return t&&w.is(t.receiver)&&T.is(t.sender)}e.is=t})(E||(e.CancellationStrategy=E={}));var D;(function(e){function t(e){let t=e;return t&&n.func(t.handleMessage)}e.is=t})(D||(e.MessageStrategy=D={}));var O;(function(e){function t(e){let t=e;return t&&(E.is(t.cancellationStrategy)||x.is(t.connectionStrategy)||D.is(t.messageStrategy))}e.is=t})(O||(e.ConnectionOptions=O={}));var k;(function(e){e[e.New=1]=`New`,e[e.Listening=2]=`Listening`,e[e.Closed=3]=`Closed`,e[e.Disposed=4]=`Disposed`})(k||={});function A(l,u,d,p){let m=d===void 0?e.NullLogger:d,ee=0,ne=0,x=0,C,w=new Map,T,O=new Map,A=new Map,re,j=new i.LinkedMap,M=new Map,N=new Set,P=new Map,F=h.Off,I=g.Text,L,R=k.New,z=new a.Emitter,ie=new a.Emitter,ae=new a.Emitter,oe=new a.Emitter,B=new a.Emitter,V=p&&p.cancellationStrategy?p.cancellationStrategy:E.Message;function H(e){if(e===null)throw Error(`Can't send requests with id null since the response can't be correlated.`);return`req-`+e.toString()}function se(e){return e===null?`res-unknown-`+(++x).toString():`res-`+e.toString()}function U(){return`not-`+(++ne).toString()}function W(e,t){r.Message.isRequest(t)?e.set(H(t.id),t):r.Message.isResponse(t)?e.set(se(t.id),t):e.set(U(),t)}function ce(e){}function G(){return R===k.Listening}function le(){return R===k.Closed}function K(){return R===k.Disposed}function q(){(R===k.New||R===k.Listening)&&(R=k.Closed,ie.fire(void 0))}function J(e){z.fire([e,void 0,void 0])}function ue(e){z.fire(e)}l.onClose(q),l.onError(J),u.onClose(q),u.onError(ue);function de(){re||j.size===0||(re=(0,t.default)().timer.setImmediate(()=>{re=void 0,pe()}))}function fe(e){r.Message.isRequest(e)?he(e):r.Message.isNotification(e)?_e(e):r.Message.isResponse(e)?ge(e):ve(e)}function pe(){if(j.size===0)return;let e=j.shift();try{let t=p?.messageStrategy;D.is(t)?t.handleMessage(e,fe):fe(e)}finally{de()}}let me=e=>{try{if(r.Message.isNotification(e)&&e.method===s.type.method){let t=e.params.id,n=H(t),i=j.get(n);if(r.Message.isRequest(i)){let r=p?.connectionStrategy,a=r&&r.cancelUndispatched?r.cancelUndispatched(i,ce):void 0;if(a&&(a.error!==void 0||a.result!==void 0)){j.delete(n),P.delete(t),a.id=i.id,xe(a,e.method,Date.now()),u.write(a).catch(()=>m.error(`Sending response for canceled message failed.`));return}}let a=P.get(t);if(a!==void 0){a.cancel(),Ce(e);return}else N.add(t)}W(j,e)}finally{de()}};function he(e){if(K())return;function t(t,n,i){let a={jsonrpc:`2.0`,id:e.id};t instanceof r.ResponseError?a.error=t.toJson():a.result=t===void 0?null:t,xe(a,n,i),u.write(a).catch(()=>m.error(`Sending response failed.`))}function i(t,n,r){let i={jsonrpc:`2.0`,id:e.id,error:t.toJson()};xe(i,n,r),u.write(i).catch(()=>m.error(`Sending response failed.`))}function a(t,n,r){t===void 0&&(t=null);let i={jsonrpc:`2.0`,id:e.id,result:t};xe(i,n,r),u.write(i).catch(()=>m.error(`Sending response failed.`))}Se(e);let o=w.get(e.method),s,c;o&&(s=o.type,c=o.handler);let l=Date.now();if(c||C){let o=e.id??String(Date.now()),u=S.is(V.receiver)?V.receiver.createCancellationTokenSource(o):V.receiver.createCancellationTokenSource(e);e.id!==null&&N.has(e.id)&&u.cancel(),e.id!==null&&P.set(o,u);try{let d;if(c)if(e.params===void 0){if(s!==void 0&&s.numberOfParams!==0){i(new r.ResponseError(r.ErrorCodes.InvalidParams,`Request ${e.method} defines ${s.numberOfParams} params but received none.`),e.method,l);return}d=c(u.token)}else if(Array.isArray(e.params)){if(s!==void 0&&s.parameterStructures===r.ParameterStructures.byName){i(new r.ResponseError(r.ErrorCodes.InvalidParams,`Request ${e.method} defines parameters by name but received parameters by position`),e.method,l);return}d=c(...e.params,u.token)}else{if(s!==void 0&&s.parameterStructures===r.ParameterStructures.byPosition){i(new r.ResponseError(r.ErrorCodes.InvalidParams,`Request ${e.method} defines parameters by position but received parameters by name`),e.method,l);return}d=c(e.params,u.token)}else C&&(d=C(e.method,e.params,u.token));let f=d;d?f.then?f.then(n=>{P.delete(o),t(n,e.method,l)},t=>{P.delete(o),t instanceof r.ResponseError?i(t,e.method,l):t&&n.string(t.message)?i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed with message: ${t.message}`),e.method,l):i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed unexpectedly without providing any details.`),e.method,l)}):(P.delete(o),t(d,e.method,l)):(P.delete(o),a(d,e.method,l))}catch(a){P.delete(o),a instanceof r.ResponseError?t(a,e.method,l):a&&n.string(a.message)?i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed with message: ${a.message}`),e.method,l):i(new r.ResponseError(r.ErrorCodes.InternalError,`Request ${e.method} failed unexpectedly without providing any details.`),e.method,l)}}else i(new r.ResponseError(r.ErrorCodes.MethodNotFound,`Unhandled method ${e.method}`),e.method,l)}function ge(e){if(!K())if(e.id===null)e.error?m.error(`Received response message without id: Error is: \n${JSON.stringify(e.error,void 0,4)}`):m.error(`Received response message without id. No further error information provided.`);else{let t=e.id,n=M.get(t);if(we(e,n),n!==void 0){M.delete(t);try{if(e.error){let t=e.error;n.reject(new r.ResponseError(t.code,t.message,t.data))}else if(e.result!==void 0)n.resolve(e.result);else throw Error(`Should never happen.`)}catch(e){e.message?m.error(`Response handler '${n.method}' failed with message: ${e.message}`):m.error(`Response handler '${n.method}' failed unexpectedly.`)}}}}function _e(e){if(K())return;let t,n;if(e.method===s.type.method){let t=e.params.id;N.delete(t),Ce(e);return}else{let r=O.get(e.method);r&&(n=r.handler,t=r.type)}if(n||T)try{if(Ce(e),n)if(e.params===void 0)t!==void 0&&t.numberOfParams!==0&&t.parameterStructures!==r.ParameterStructures.byName&&m.error(`Notification ${e.method} defines ${t.numberOfParams} params but received none.`),n();else if(Array.isArray(e.params)){let i=e.params;e.method===f.type.method&&i.length===2&&c.is(i[0])?n({token:i[0],value:i[1]}):(t!==void 0&&(t.parameterStructures===r.ParameterStructures.byName&&m.error(`Notification ${e.method} defines parameters by name but received parameters by position`),t.numberOfParams!==e.params.length&&m.error(`Notification ${e.method} defines ${t.numberOfParams} params but received ${i.length} arguments`)),n(...i))}else t!==void 0&&t.parameterStructures===r.ParameterStructures.byPosition&&m.error(`Notification ${e.method} defines parameters by position but received parameters by name`),n(e.params);else T&&T(e.method,e.params)}catch(t){t.message?m.error(`Notification handler '${e.method}' failed with message: ${t.message}`):m.error(`Notification handler '${e.method}' failed unexpectedly.`)}else ae.fire(e)}function ve(e){if(!e){m.error(`Received empty message.`);return}m.error(`Received message which is neither a response nor a notification message:\n${JSON.stringify(e,null,4)}`);let t=e;if(n.string(t.id)||n.number(t.id)){let e=t.id,n=M.get(e);n&&n.reject(Error(`The received response has neither a result nor an error property.`))}}function Y(e){if(e!=null)switch(F){case h.Verbose:return JSON.stringify(e,null,4);case h.Compact:return JSON.stringify(e);default:return}}function ye(e){if(!(F===h.Off||!L))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&e.params&&(t=`Params: ${Y(e.params)}\n\n`),L.log(`Sending request '${e.method} - (${e.id})'.`,t)}else X(`send-request`,e)}function be(e){if(!(F===h.Off||!L))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&(t=e.params?`Params: ${Y(e.params)}\n\n`:`No parameters provided.

`),L.log(`Sending notification '${e.method}'.`,t)}else X(`send-notification`,e)}function xe(e,t,n){if(!(F===h.Off||!L))if(I===g.Text){let r;(F===h.Verbose||F===h.Compact)&&(e.error&&e.error.data?r=`Error data: ${Y(e.error.data)}\n\n`:e.result?r=`Result: ${Y(e.result)}\n\n`:e.error===void 0&&(r=`No result returned.

`)),L.log(`Sending response '${t} - (${e.id})'. Processing request took ${Date.now()-n}ms`,r)}else X(`send-response`,e)}function Se(e){if(!(F===h.Off||!L))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&e.params&&(t=`Params: ${Y(e.params)}\n\n`),L.log(`Received request '${e.method} - (${e.id})'.`,t)}else X(`receive-request`,e)}function Ce(e){if(!(F===h.Off||!L||e.method===v.type.method))if(I===g.Text){let t;(F===h.Verbose||F===h.Compact)&&(t=e.params?`Params: ${Y(e.params)}\n\n`:`No parameters provided.

`),L.log(`Received notification '${e.method}'.`,t)}else X(`receive-notification`,e)}function we(e,t){if(!(F===h.Off||!L))if(I===g.Text){let n;if((F===h.Verbose||F===h.Compact)&&(e.error&&e.error.data?n=`Error data: ${Y(e.error.data)}\n\n`:e.result?n=`Result: ${Y(e.result)}\n\n`:e.error===void 0&&(n=`No result returned.

`)),t){let r=e.error?` Request failed: ${e.error.message} (${e.error.code}).`:``;L.log(`Received response '${t.method} - (${e.id})' in ${Date.now()-t.timerStart}ms.${r}`,n)}else L.log(`Received response ${e.id} without active response promise.`,n)}else X(`receive-response`,e)}function X(e,t){if(!L||F===h.Off)return;let n={isLSPMessage:!0,type:e,message:t,timestamp:Date.now()};L.log(n)}function Z(){if(le())throw new b(y.Closed,`Connection is closed.`);if(K())throw new b(y.Disposed,`Connection is disposed.`)}function Te(){if(G())throw new b(y.AlreadyListening,`Connection is already listening`)}function Ee(){if(!G())throw Error(`Call listen() first.`)}function Q(e){return e===void 0?null:e}function De(e){if(e!==null)return e}function Oe(e){return e!=null&&!Array.isArray(e)&&typeof e==`object`}function ke(e,t){switch(e){case r.ParameterStructures.auto:return Oe(t)?De(t):[Q(t)];case r.ParameterStructures.byName:if(!Oe(t))throw Error(`Received parameters by name but param is not an object literal.`);return De(t);case r.ParameterStructures.byPosition:return[Q(t)];default:throw Error(`Unknown parameter structure ${e.toString()}`)}}function Ae(e,t){let n,r=e.numberOfParams;switch(r){case 0:n=void 0;break;case 1:n=ke(e.parameterStructures,t[0]);break;default:n=[];for(let e=0;e<t.length&&e<r;e++)n.push(Q(t[e]));if(t.length<r)for(let e=t.length;e<r;e++)n.push(null);break}return n}let $={sendNotification:(e,...t)=>{Z();let i,a;if(n.string(e)){i=e;let n=t[0],o=0,s=r.ParameterStructures.auto;r.ParameterStructures.is(n)&&(o=1,s=n);let c=t.length,l=c-o;switch(l){case 0:a=void 0;break;case 1:a=ke(s,t[o]);break;default:if(s===r.ParameterStructures.byName)throw Error(`Received ${l} parameters for 'by Name' notification parameter structure.`);a=t.slice(o,c).map(e=>Q(e));break}}else{let n=t;i=e.method,a=Ae(e,n)}let o={jsonrpc:`2.0`,method:i,params:a};return be(o),u.write(o).catch(e=>{throw m.error(`Sending notification failed.`),e})},onNotification:(e,t)=>{Z();let r;return n.func(e)?T=e:t&&(n.string(e)?(r=e,O.set(e,{type:void 0,handler:t})):(r=e.method,O.set(e.method,{type:e,handler:t}))),{dispose:()=>{r===void 0?T=void 0:O.delete(r)}}},onProgress:(e,t,n)=>{if(A.has(t))throw Error(`Progress handler for token ${t} already registered`);return A.set(t,n),{dispose:()=>{A.delete(t)}}},sendProgress:(e,t,n)=>$.sendNotification(f.type,{token:t,value:n}),onUnhandledProgress:oe.event,sendRequest:(e,...t)=>{Z(),Ee();let i,a,s;if(n.string(e)){i=e;let n=t[0],c=t[t.length-1],l=0,u=r.ParameterStructures.auto;r.ParameterStructures.is(n)&&(l=1,u=n);let d=t.length;o.CancellationToken.is(c)&&(--d,s=c);let f=d-l;switch(f){case 0:a=void 0;break;case 1:a=ke(u,t[l]);break;default:if(u===r.ParameterStructures.byName)throw Error(`Received ${f} parameters for 'by Name' request parameter structure.`);a=t.slice(l,d).map(e=>Q(e));break}}else{let n=t;i=e.method,a=Ae(e,n);let r=e.numberOfParams;s=o.CancellationToken.is(n[r])?n[r]:void 0}let c=ee++,l;s&&(l=s.onCancellationRequested(()=>{let e=V.sender.sendCancellation($,c);return e===void 0?(m.log(`Received no promise from cancellation strategy when cancelling id ${c}`),Promise.resolve()):e.catch(()=>{m.log(`Sending cancellation messages for id ${c} failed`)})}));let d={jsonrpc:`2.0`,id:c,method:i,params:a};return ye(d),typeof V.sender.enableCancellation==`function`&&V.sender.enableCancellation(d),new Promise(async(e,t)=>{let n={method:i,timerStart:Date.now(),resolve:t=>{e(t),V.sender.cleanup(c),l?.dispose()},reject:e=>{t(e),V.sender.cleanup(c),l?.dispose()}};try{M.set(c,n),await u.write(d)}catch(e){throw M.delete(c),n.reject(new r.ResponseError(r.ErrorCodes.MessageWriteError,e.message?e.message:`Unknown reason`)),m.error(`Sending request failed.`),e}})},onRequest:(e,t)=>{Z();let r=null;return te.is(e)?(r=void 0,C=e):n.string(e)?(r=null,t!==void 0&&(r=e,w.set(e,{handler:t,type:void 0}))):t!==void 0&&(r=e.method,w.set(e.method,{type:e,handler:t})),{dispose:()=>{r!==null&&(r===void 0?C=void 0:w.delete(r))}}},hasPendingResponse:()=>M.size>0,trace:async(e,t,r)=>{let i=!1,a=g.Text;r!==void 0&&(n.boolean(r)?i=r:(i=r.sendNotification||!1,a=r.traceFormat||g.Text)),F=e,I=a,L=F===h.Off?void 0:t,i&&!le()&&!K()&&await $.sendNotification(_.type,{value:h.toString(e)})},onError:z.event,onClose:ie.event,onUnhandledNotification:ae.event,onDispose:B.event,end:()=>{u.end()},dispose:()=>{if(K())return;R=k.Disposed,B.fire(void 0);let e=new r.ResponseError(r.ErrorCodes.PendingResponseRejected,`Pending response rejected since connection got disposed`);for(let t of M.values())t.reject(e);M=new Map,P=new Map,N=new Set,j=new i.LinkedMap,n.func(u.dispose)&&u.dispose(),n.func(l.dispose)&&l.dispose()},listen:()=>{Z(),Te(),R=k.Listening,l.listen(me)},inspect:()=>{(0,t.default)().console.log(`inspect`)}};return $.onNotification(v.type,e=>{if(F===h.Off||!L)return;let t=F===h.Verbose||F===h.Compact;L.log(e.message,t?e.verbose:void 0)}),$.onNotification(f.type,e=>{let t=A.get(e.token);t?t(e.value):oe.fire(e)}),$}e.createMessageConnection=A})),y=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0}),e.ProgressType=e.ProgressToken=e.createMessageConnection=e.NullLogger=e.ConnectionOptions=e.ConnectionStrategy=e.AbstractMessageBuffer=e.WriteableStreamMessageWriter=e.AbstractMessageWriter=e.MessageWriter=e.ReadableStreamMessageReader=e.AbstractMessageReader=e.MessageReader=e.SharedArrayReceiverStrategy=e.SharedArraySenderStrategy=e.CancellationToken=e.CancellationTokenSource=e.Emitter=e.Event=e.Disposable=e.LRUCache=e.Touch=e.LinkedMap=e.ParameterStructures=e.NotificationType9=e.NotificationType8=e.NotificationType7=e.NotificationType6=e.NotificationType5=e.NotificationType4=e.NotificationType3=e.NotificationType2=e.NotificationType1=e.NotificationType0=e.NotificationType=e.ErrorCodes=e.ResponseError=e.RequestType9=e.RequestType8=e.RequestType7=e.RequestType6=e.RequestType5=e.RequestType4=e.RequestType3=e.RequestType2=e.RequestType1=e.RequestType0=e.RequestType=e.Message=e.RAL=void 0,e.MessageStrategy=e.CancellationStrategy=e.CancellationSenderStrategy=e.CancellationReceiverStrategy=e.ConnectionError=e.ConnectionErrors=e.LogTraceNotification=e.SetTraceNotification=e.TraceFormat=e.TraceValues=e.Trace=void 0;let t=u();Object.defineProperty(e,`Message`,{enumerable:!0,get:function(){return t.Message}}),Object.defineProperty(e,`RequestType`,{enumerable:!0,get:function(){return t.RequestType}}),Object.defineProperty(e,`RequestType0`,{enumerable:!0,get:function(){return t.RequestType0}}),Object.defineProperty(e,`RequestType1`,{enumerable:!0,get:function(){return t.RequestType1}}),Object.defineProperty(e,`RequestType2`,{enumerable:!0,get:function(){return t.RequestType2}}),Object.defineProperty(e,`RequestType3`,{enumerable:!0,get:function(){return t.RequestType3}}),Object.defineProperty(e,`RequestType4`,{enumerable:!0,get:function(){return t.RequestType4}}),Object.defineProperty(e,`RequestType5`,{enumerable:!0,get:function(){return t.RequestType5}}),Object.defineProperty(e,`RequestType6`,{enumerable:!0,get:function(){return t.RequestType6}}),Object.defineProperty(e,`RequestType7`,{enumerable:!0,get:function(){return t.RequestType7}}),Object.defineProperty(e,`RequestType8`,{enumerable:!0,get:function(){return t.RequestType8}}),Object.defineProperty(e,`RequestType9`,{enumerable:!0,get:function(){return t.RequestType9}}),Object.defineProperty(e,`ResponseError`,{enumerable:!0,get:function(){return t.ResponseError}}),Object.defineProperty(e,`ErrorCodes`,{enumerable:!0,get:function(){return t.ErrorCodes}}),Object.defineProperty(e,`NotificationType`,{enumerable:!0,get:function(){return t.NotificationType}}),Object.defineProperty(e,`NotificationType0`,{enumerable:!0,get:function(){return t.NotificationType0}}),Object.defineProperty(e,`NotificationType1`,{enumerable:!0,get:function(){return t.NotificationType1}}),Object.defineProperty(e,`NotificationType2`,{enumerable:!0,get:function(){return t.NotificationType2}}),Object.defineProperty(e,`NotificationType3`,{enumerable:!0,get:function(){return t.NotificationType3}}),Object.defineProperty(e,`NotificationType4`,{enumerable:!0,get:function(){return t.NotificationType4}}),Object.defineProperty(e,`NotificationType5`,{enumerable:!0,get:function(){return t.NotificationType5}}),Object.defineProperty(e,`NotificationType6`,{enumerable:!0,get:function(){return t.NotificationType6}}),Object.defineProperty(e,`NotificationType7`,{enumerable:!0,get:function(){return t.NotificationType7}}),Object.defineProperty(e,`NotificationType8`,{enumerable:!0,get:function(){return t.NotificationType8}}),Object.defineProperty(e,`NotificationType9`,{enumerable:!0,get:function(){return t.NotificationType9}}),Object.defineProperty(e,`ParameterStructures`,{enumerable:!0,get:function(){return t.ParameterStructures}});let n=d();Object.defineProperty(e,`LinkedMap`,{enumerable:!0,get:function(){return n.LinkedMap}}),Object.defineProperty(e,`LRUCache`,{enumerable:!0,get:function(){return n.LRUCache}}),Object.defineProperty(e,`Touch`,{enumerable:!0,get:function(){return n.Touch}});let r=f();Object.defineProperty(e,`Disposable`,{enumerable:!0,get:function(){return r.Disposable}});let i=m();Object.defineProperty(e,`Event`,{enumerable:!0,get:function(){return i.Event}}),Object.defineProperty(e,`Emitter`,{enumerable:!0,get:function(){return i.Emitter}});let a=ee();Object.defineProperty(e,`CancellationTokenSource`,{enumerable:!0,get:function(){return a.CancellationTokenSource}}),Object.defineProperty(e,`CancellationToken`,{enumerable:!0,get:function(){return a.CancellationToken}});let o=te();Object.defineProperty(e,`SharedArraySenderStrategy`,{enumerable:!0,get:function(){return o.SharedArraySenderStrategy}}),Object.defineProperty(e,`SharedArrayReceiverStrategy`,{enumerable:!0,get:function(){return o.SharedArrayReceiverStrategy}});let s=ne();Object.defineProperty(e,`MessageReader`,{enumerable:!0,get:function(){return s.MessageReader}}),Object.defineProperty(e,`AbstractMessageReader`,{enumerable:!0,get:function(){return s.AbstractMessageReader}}),Object.defineProperty(e,`ReadableStreamMessageReader`,{enumerable:!0,get:function(){return s.ReadableStreamMessageReader}});let c=g();Object.defineProperty(e,`MessageWriter`,{enumerable:!0,get:function(){return c.MessageWriter}}),Object.defineProperty(e,`AbstractMessageWriter`,{enumerable:!0,get:function(){return c.AbstractMessageWriter}}),Object.defineProperty(e,`WriteableStreamMessageWriter`,{enumerable:!0,get:function(){return c.WriteableStreamMessageWriter}});let l=_();Object.defineProperty(e,`AbstractMessageBuffer`,{enumerable:!0,get:function(){return l.AbstractMessageBuffer}});let h=v();Object.defineProperty(e,`ConnectionStrategy`,{enumerable:!0,get:function(){return h.ConnectionStrategy}}),Object.defineProperty(e,`ConnectionOptions`,{enumerable:!0,get:function(){return h.ConnectionOptions}}),Object.defineProperty(e,`NullLogger`,{enumerable:!0,get:function(){return h.NullLogger}}),Object.defineProperty(e,`createMessageConnection`,{enumerable:!0,get:function(){return h.createMessageConnection}}),Object.defineProperty(e,`ProgressToken`,{enumerable:!0,get:function(){return h.ProgressToken}}),Object.defineProperty(e,`ProgressType`,{enumerable:!0,get:function(){return h.ProgressType}}),Object.defineProperty(e,`Trace`,{enumerable:!0,get:function(){return h.Trace}}),Object.defineProperty(e,`TraceValues`,{enumerable:!0,get:function(){return h.TraceValues}}),Object.defineProperty(e,`TraceFormat`,{enumerable:!0,get:function(){return h.TraceFormat}}),Object.defineProperty(e,`SetTraceNotification`,{enumerable:!0,get:function(){return h.SetTraceNotification}}),Object.defineProperty(e,`LogTraceNotification`,{enumerable:!0,get:function(){return h.LogTraceNotification}}),Object.defineProperty(e,`ConnectionErrors`,{enumerable:!0,get:function(){return h.ConnectionErrors}}),Object.defineProperty(e,`ConnectionError`,{enumerable:!0,get:function(){return h.ConnectionError}}),Object.defineProperty(e,`CancellationReceiverStrategy`,{enumerable:!0,get:function(){return h.CancellationReceiverStrategy}}),Object.defineProperty(e,`CancellationSenderStrategy`,{enumerable:!0,get:function(){return h.CancellationSenderStrategy}}),Object.defineProperty(e,`CancellationStrategy`,{enumerable:!0,get:function(){return h.CancellationStrategy}}),Object.defineProperty(e,`MessageStrategy`,{enumerable:!0,get:function(){return h.MessageStrategy}}),e.RAL=p().default})),b=o((e=>{Object.defineProperty(e,`__esModule`,{value:!0});let t=y();var n=class e extends t.AbstractMessageBuffer{constructor(e=`utf-8`){super(e),this.asciiDecoder=new TextDecoder(`ascii`)}emptyBuffer(){return e.emptyBuffer}fromString(e,t){return new TextEncoder().encode(e)}toString(e,t){return t===`ascii`?this.asciiDecoder.decode(e):new TextDecoder(t).decode(e)}asNative(e,t){return t===void 0?e:e.slice(0,t)}allocNative(e){return new Uint8Array(e)}};n.emptyBuffer=new Uint8Array;var r=class{constructor(e){this.socket=e,this._onData=new t.Emitter,this._messageListener=e=>{e.data.arrayBuffer().then(e=>{this._onData.fire(new Uint8Array(e))},()=>{(0,t.RAL)().console.error(`Converting blob to array buffer failed.`)})},this.socket.addEventListener(`message`,this._messageListener)}onClose(e){return this.socket.addEventListener(`close`,e),t.Disposable.create(()=>this.socket.removeEventListener(`close`,e))}onError(e){return this.socket.addEventListener(`error`,e),t.Disposable.create(()=>this.socket.removeEventListener(`error`,e))}onEnd(e){return this.socket.addEventListener(`end`,e),t.Disposable.create(()=>this.socket.removeEventListener(`end`,e))}onData(e){return this._onData.event(e)}},i=class{constructor(e){this.socket=e}onClose(e){return this.socket.addEventListener(`close`,e),t.Disposable.create(()=>this.socket.removeEventListener(`close`,e))}onError(e){return this.socket.addEventListener(`error`,e),t.Disposable.create(()=>this.socket.removeEventListener(`error`,e))}onEnd(e){return this.socket.addEventListener(`end`,e),t.Disposable.create(()=>this.socket.removeEventListener(`end`,e))}write(e,t){if(typeof e==`string`){if(t!==void 0&&t!==`utf-8`)throw Error(`In a Browser environments only utf-8 text encoding is supported. But got encoding: ${t}`);this.socket.send(e)}else this.socket.send(e);return Promise.resolve()}end(){this.socket.close()}};let a=new TextEncoder,o=Object.freeze({messageBuffer:Object.freeze({create:e=>new n(e)}),applicationJson:Object.freeze({encoder:Object.freeze({name:`application/json`,encode:(e,t)=>{if(t.charset!==`utf-8`)throw Error(`In a Browser environments only utf-8 text encoding is supported. But got encoding: ${t.charset}`);return Promise.resolve(a.encode(JSON.stringify(e,void 0,0)))}}),decoder:Object.freeze({name:`application/json`,decode:(e,t)=>{if(!(e instanceof Uint8Array))throw Error(`In a Browser environments only Uint8Arrays are supported.`);return Promise.resolve(JSON.parse(new TextDecoder(t.charset).decode(e)))}})}),stream:Object.freeze({asReadableStream:e=>new r(e),asWritableStream:e=>new i(e)}),console,timer:Object.freeze({setTimeout(e,t,...n){let r=setTimeout(e,t,...n);return{dispose:()=>clearTimeout(r)}},setImmediate(e,...t){let n=setTimeout(e,0,...t);return{dispose:()=>clearTimeout(n)}},setInterval(e,t,...n){let r=setInterval(e,t,...n);return{dispose:()=>clearInterval(r)}}})});function s(){return o}(function(e){function n(){t.RAL.install(o)}e.install=n})(s||={}),e.default=s}));const x=c(o((e=>{var t=e&&e.__createBinding||(Object.create?(function(e,t,n,r){r===void 0&&(r=n);var i=Object.getOwnPropertyDescriptor(t,n);(!i||(`get`in i?!t.__esModule:i.writable||i.configurable))&&(i={enumerable:!0,get:function(){return t[n]}}),Object.defineProperty(e,r,i)}):(function(e,t,n,r){r===void 0&&(r=n),e[r]=t[n]})),n=e&&e.__exportStar||function(e,n){for(var r in e)r!==`default`&&!Object.prototype.hasOwnProperty.call(n,r)&&t(n,e,r)};Object.defineProperty(e,`__esModule`,{value:!0}),e.createMessageConnection=e.BrowserMessageWriter=e.BrowserMessageReader=void 0,b().default.install();let r=y();n(y(),e),e.BrowserMessageReader=class extends r.AbstractMessageReader{constructor(e){super(),this._onData=new r.Emitter,this._messageListener=e=>{this._onData.fire(e.data)},e.addEventListener(`error`,e=>this.fireError(e)),e.onmessage=this._messageListener}listen(e){return this._onData.event(e)}},e.BrowserMessageWriter=class extends r.AbstractMessageWriter{constructor(e){super(),this.port=e,this.errorCount=0,e.addEventListener(`error`,e=>this.fireError(e))}write(e){try{return this.port.postMessage(e),Promise.resolve()}catch(t){return this.handleError(t,e),Promise.reject(t)}}handleError(e,t){this.errorCount++,this.fireError(e,t,this.errorCount)}end(){}};function i(e,t,n,i){return n===void 0&&(n=r.NullLogger),r.ConnectionStrategy.is(i)&&(i={connectionStrategy:i}),(0,r.createMessageConnection)(e,t,n,i)}e.createMessageConnection=i}))(),1).default,S=x.BrowserMessageReader,C=x.BrowserMessageWriter,w=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP
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
`,T=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP
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
`,E=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP
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
`,D=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP
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
`,O=String.raw`#ifndef WASM_CLANG_EXT_ROPE
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
`,k=String.raw`#ifndef WASM_CLANG_SETJMP_H
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
`,A=String.raw`#ifndef WASM_CLANG_BITS_STDCPP_H
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
`,re=String.raw`#ifndef WASM_CLANG_BITS_EXTCXX_H
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
`,j=[{path:`include/setjmp.h`,contents:k},{path:`include/bits/stdc++.h`,contents:A},{path:`include/bits/extc++.h`,contents:re},{path:`include/c++/v1/ext/rope`,contents:O},{path:`include/c++/v1/ext/pb_ds/tree_policy.hpp`,contents:w},{path:`include/c++/v1/ext/pb_ds/assoc_container.hpp`,contents:T},{path:`include/c++/v1/ext/pb_ds/hash_policy.hpp`,contents:E},{path:`include/c++/v1/ext/pb_ds/priority_queue.hpp`,contents:D}],M=[`include/c++/v1/ext/pb_ds`,`include/bits`],N=(e,t)=>{let n=e.replace(/\/+$/,``),r=t.replace(/^\/+/,``);return n?`${n}/${r}`:r};function P(e,t=``){for(let n of M)e.mkdirTree(N(t,n));for(let n of j)e.writeFile(N(t,n.path),n.contents)}const F=`/workspace`;`${F}`;const I=`${F}/main.cpp`;`${I}`;const L=e=>e.endsWith(`/`)?e.slice(0,-1):e,R=()=>[`-std=gnu++2a`,`-xc++`,`--target=wasm32-wasi`,`-isystem/usr/include/c++/v1`,`-isystem/usr/include/wasm32-wasi/c++/v1`,`-isystem/usr/include`,`-isystem/usr/include/wasm32-wasi`];var z=class{inJson=!1;rawText=[];unbalancedBraces=0;inString=!1;inEscape=0;textDecoder=new TextDecoder;insert(e){if(!this.inJson&&e===123&&(this.inJson=!0,this.rawText=[]),!this.inJson)return null;if(this.rawText.push(e),this.inString)this.inEscape?(e===75&&(this.inEscape+=4),--this.inEscape):e===92?this.inEscape=1:e===34&&(this.inString=!1);else if(e===123)this.unbalancedBraces+=1;else if(e===125){if(--this.unbalancedBraces,this.unbalancedBraces===0)return this.inJson=!1,this.textDecoder.decode(new Uint8Array(this.rawText))}else e===34&&(this.inString=!0);return null}};const ie=new TextEncoder,ae=new TextDecoder,oe=new z;let B=()=>{};const V=[],H=[];let se=!1,U=``;const W=e=>{let t=e;return!t||typeof t!=`object`?typeof e:typeof t.method==`string`?t.method:t.id===void 0?`unknown`:`response:${String(t.id)}`},ce=e=>{let t=e;return!!t&&typeof t==`object`&&t.jsonrpc===`2.0`},G=(...e)=>{se&&console.debug(`[wasm-idle:clangd-worker]`,...e)},le=()=>{if(H.length===0){if(V.length===0)return null;let e=V.shift();if(!e)return null;H.push(...ie.encode(e))}return H.shift()??null},K=async()=>{if(V.length===0)return new Promise(e=>{B=e})};let q=null,J=null;const ue=e=>{let t=oe.insert(e);if(!t||!q)return;let n=JSON.parse(t);G(`stdout`,W(n)),q.write(n)},de=e=>{if(se){if(e===10||e===13){U&&G(`stderr`,U),U=``;return}U+=String.fromCharCode(e)}},fe=()=>{q?.end(),self.reportError?.(`clangd aborted`)},pe=e=>{if(!J)return;let t=e.startsWith(`/workspace`)?e:`${F}/${e.replace(/^\/+/,``)}`,n=t.lastIndexOf(`/`),r=n>0?t.slice(0,n):F;J.FS.mkdirTree(r),J.FS.writeFile(t,``)};async function me(e,t){let n=await fetch(new URL(t,e).href);if(!n.ok)throw Error(`Failed to load ${t}: ${n.status}`);return new Uint8Array(await n.arrayBuffer())}async function he(e){if(e[0]!==31||e[1]!==139)return e;if(typeof DecompressionStream>`u`)throw Error(`Failed to decompress clangd.wasm.gz: DecompressionStream is unavailable`);let t=new Uint8Array(e.byteLength);t.set(e);let n=new Blob([t.buffer]).stream().pipeThrough(new DecompressionStream(`gzip`));return new Uint8Array(await new Response(n).arrayBuffer())}self.addEventListener(`message`,async e=>{if(e.data?.type===`sync-file`&&typeof e.data?.name==`string`){pe(e.data.name);return}if(e.data?.type!==`init`)return;let t=L(e.data.baseUrl||`/clangd`)+`/`;se=!!e.data.debug,G(`init`,t);try{let n=e.data.assets?.clangdJs?new Uint8Array(e.data.assets.clangdJs):await me(t,`clangd.js`);self.postMessage({type:`progress`,value:1,max:3});let r=ae.decode(n),i=URL.createObjectURL(new Blob([r],{type:`text/javascript;charset=utf-8`})),a=import(i),o=e.data.assets?.clangdWasmGz?new Uint8Array(e.data.assets.clangdWasmGz):await me(t,`clangd.wasm.gz`);self.postMessage({type:`progress`,value:2,max:3});let s=await he(o);self.postMessage({type:`progress`,value:3,max:3});let c=new Uint8Array(s.byteLength);c.set(s);let l=new Blob([c.buffer],{type:`application/wasm`}),u=URL.createObjectURL(l),{default:d}=await a;J=await d({thisProgram:`/usr/bin/clangd`,mainScriptUrlOrBlob:i,locateFile:(e,t)=>e.endsWith(`.wasm`)?u:`${t}${e}`,stdinReady:K,stdin:le,stdout:ue,stderr:de,onExit:fe,onAbort:fe}),J.FS.mkdirTree(F),P(J.FS,`/usr`),pe(I),J.FS.writeFile(`${F}/.clangd`,JSON.stringify({CompileFlags:{Add:R()}})),G(`callMain start`),G(`callMain returned`,J.callMain([])),q=new C(self),new S(self).listen(e=>{if(!ce(e)){G(`ignored control message`,W(e));return}G(`stdin message`,W(e));let t=JSON.stringify(e).replace(/[\u007F-\uFFFF]/g,e=>`\\u`+e.codePointAt(0)?.toString(16).padStart(4,`0`)),n=ie.encode(t).byteLength;V.push(`Content-Length: ${n}\r\n\r\n${t}`),G(`stdin queued bytes`,n),B()}),self.postMessage({type:`ready`,value:s.byteLength})}catch(e){self.postMessage({type:`error`,message:e instanceof Error?e.message:String(e)})}});