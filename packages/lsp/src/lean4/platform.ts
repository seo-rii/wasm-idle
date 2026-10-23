/** Adapt only Emscripten pthread stdin and pool allocation. The Lean Wasm bytes stay unchanged. */
export function adaptLean4Glue(source: string, poolSize: number): string {
	let glue = source;
	const replace = (from: string, to: string) => {
		if (glue.split(from).length !== 2) throw new Error(`Unsupported pinned Lean glue: ${from}`);
		glue = glue.replace(from, to);
	};
	replace(
		'worker.postMessage({cmd:1,handlers,wasmMemory,wasmModule})',
		'worker.postMessage({cmd:1,handlers,wasmMemory,wasmModule,lspStdin:Module["lspStdin"]})'
	);
	replace(
		'wasmMemory=msgData.wasmMemory;updateMemoryViews();',
		'Module["lspStdin"]=msgData.lspStdin;wasmMemory=msgData.wasmMemory;updateMemoryViews();'
	);
	replace('var pthreadPoolSize=4;', `var pthreadPoolSize=${poolSize};`);
	// callMain owns a synchronous native event loop. A completed pthread's ordinary JS
	// postMessage cannot run there, so recycle it through Emscripten's native proxy queue,
	// just like the original filesystem and pthread-create calls. This keeps repeated edits
	// from consuming the fixed worker pool even after their Lean tasks have completed.
	const table = glue.match(/var proxiedFunctionTable=\[([^\]]+)\];/);
	if (!table) throw new Error('Unsupported pinned Lean proxy table.');
	const cleanupIndex = table[1].split(',').length;
	replace(table[0], table[0].replace('];', ',__emscripten_thread_cleanup];'));
	replace(
		'if(!ENVIRONMENT_IS_PTHREAD)cleanupThread(thread);else postMessage({cmd:6,thread})',
		`if(!ENVIRONMENT_IS_PTHREAD)cleanupThread(thread);else proxyToMainThread(${cleanupIndex},0,1,thread)`
	);
	// A pthread may exit the process while Emscripten's keepalive is set. Module.onExit is
	// conditional on that flag, so observe the actual owner-thread WASI process exit too.
	replace(
		'_proc_exit(code){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(0,0,1,code);EXITSTATUS=code;',
		'_proc_exit(code){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(0,0,1,code);EXITSTATUS=code;Module["lspProcessExit"]?.(code);'
	);
	// Lean ServerTask uses dedicated threads; a late, asynchronously loaded worker can deadlock
	// behind the synchronous native callMain. Bound this explicitly instead of silently hanging.
	replace(
		'getNewWorker(){if(PThread.unusedWorkers.length==0){',
		`getNewWorker(){if(PThread.unusedWorkers.length==0){throw new Error("Lean LSP exhausted its ${poolSize}-thread pool");`
	);
	// Emscripten normally proxies fd_read to the owner thread. Blocking stdin there would prevent
	// other pthreads' original FS and stdout proxies from running. Only fd 0 reads the shared ring.
	replace(
		'function _fd_read(fd,iov,iovcnt,pnum){',
		`function _fd_read(fd,iov,iovcnt,pnum){
if(fd===0&&Module["lspStdin"]){
 var d=Module["lspStdin"],c=new Int32Array(d.buffer,0,4),input=new Uint8Array(d.buffer,16,d.capacity),range=Math.floor(4294967296/d.capacity)*d.capacity;
 while(Atomics.load(c,0)===Atomics.load(c,1)&&!Atomics.load(c,2))Atomics.wait(c,0,Atomics.load(c,0),100);
 growMemViews();var total=0,stop=false;
 for(var k=0;k<iovcnt&&!stop;k++){var ptr=HEAPU32[(iov+k*8)>>>2],len=HEAPU32[(iov+k*8+4)>>>2];
  for(var j=0;j<len;j++){var r=Atomics.load(c,1)>>>0,w=Atomics.load(c,0)>>>0;if(r===w){stop=true;break;}HEAPU8[ptr+j]=input[r%d.capacity];Atomics.store(c,1,(r+1)%range);total++;}
 }
 HEAPU32[pnum>>>2]=total;Atomics.notify(c,1);return 0;
}`
	);
	return glue;
}
