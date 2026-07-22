var e=class e{static read_bytes(t,n){let r=new e;return r.buf=t.getUint32(n,!0),r.buf_len=t.getUint32(n+4,!0),r}static read_bytes_array(t,n,r){let i=[];for(let a=0;a<r;a++)i.push(e.read_bytes(t,n+8*a));return i}},t=class e{static read_bytes(t,n){let r=new e;return r.buf=t.getUint32(n,!0),r.buf_len=t.getUint32(n+4,!0),r}static read_bytes_array(t,n,r){let i=[];for(let a=0;a<r;a++)i.push(e.read_bytes(t,n+8*a));return i}},n=class{head_length(){return 24}name_length(){return this.dir_name.byteLength}write_head_bytes(e,t){e.setBigUint64(t,this.d_next,!0),e.setBigUint64(t+8,this.d_ino,!0),e.setUint32(t+16,this.dir_name.length,!0),e.setUint8(t+20,this.d_type)}write_name_bytes(e,t,n){e.set(this.dir_name.slice(0,Math.min(this.dir_name.byteLength,n)),t)}constructor(e,t,n,r){let i=new TextEncoder().encode(n);this.d_next=e,this.d_ino=t,this.d_namlen=i.byteLength,this.d_type=r,this.dir_name=i}},r=class{write_bytes(e,t){e.setUint8(t,this.fs_filetype),e.setUint16(t+2,this.fs_flags,!0),e.setBigUint64(t+8,this.fs_rights_base,!0),e.setBigUint64(t+16,this.fs_rights_inherited,!0)}constructor(e,t){this.fs_rights_base=0n,this.fs_rights_inherited=0n,this.fs_filetype=e,this.fs_flags=t}},i=class{write_bytes(e,t){e.setBigUint64(t,this.dev,!0),e.setBigUint64(t+8,this.ino,!0),e.setUint8(t+16,this.filetype),e.setBigUint64(t+24,this.nlink,!0),e.setBigUint64(t+32,this.size,!0),e.setBigUint64(t+38,this.atim,!0),e.setBigUint64(t+46,this.mtim,!0),e.setBigUint64(t+52,this.ctim,!0)}constructor(e,t,n){this.dev=0n,this.nlink=0n,this.atim=0n,this.mtim=0n,this.ctim=0n,this.ino=e,this.filetype=t,this.size=n}},a=class e{static read_bytes(t,n){return new e(t.getBigUint64(n,!0),t.getUint8(n+8),t.getUint32(n+16,!0),t.getBigUint64(n+24,!0),t.getUint16(n+36,!0))}constructor(e,t,n,r,i){this.userdata=e,this.eventtype=t,this.clockid=n,this.timeout=r,this.flags=i}},o=class{write_bytes(e,t){e.setBigUint64(t,this.userdata,!0),e.setUint16(t+8,this.error,!0),e.setUint8(t+10,this.eventtype)}constructor(e,t,n){this.userdata=e,this.error=t,this.eventtype=n}},s=class{write_bytes(e,t){e.setUint32(t,this.pr_name.byteLength,!0)}constructor(e){this.pr_name=new TextEncoder().encode(e)}},c=class e{static dir(t){let n=new e;return n.tag=0,n.inner=new s(t),n}write_bytes(e,t){e.setUint32(t,this.tag,!0),this.inner.write_bytes(e,t+4)}};let l=class{enable(e){this.log=u(e===void 0?!0:e,this.prefix)}get enabled(){return this.isEnabled}constructor(e){this.isEnabled=e,this.prefix=`wasi:`,this.enable(e)}};function u(e,t){return e?console.log.bind(console,`%c%s`,`color: #265BA0`,t):()=>{}}const d=new l(!1);var f=class extends Error{constructor(e){super(`exit with exit code `+e),this.code=e}};let p=class{start(e){this.inst=e;try{return e.exports._start(),0}catch(e){if(e instanceof f)return e.code;throw e}}initialize(e){this.inst=e,e.exports._initialize&&e.exports._initialize()}constructor(n,r,i,s={}){this.args=[],this.env=[],this.fds=[],d.enable(s.debug),this.args=n,this.env=r,this.fds=i;let c=this;this.wasiImport={args_sizes_get(e,t){let n=new DataView(c.inst.exports.memory.buffer);n.setUint32(e,c.args.length,!0);let r=0;for(let e of c.args)r+=e.length+1;return n.setUint32(t,r,!0),d.log(n.getUint32(e,!0),n.getUint32(t,!0)),0},args_get(e,t){let n=new DataView(c.inst.exports.memory.buffer),r=new Uint8Array(c.inst.exports.memory.buffer),i=t;for(let i=0;i<c.args.length;i++){n.setUint32(e,t,!0),e+=4;let a=new TextEncoder().encode(c.args[i]);r.set(a,t),n.setUint8(t+a.length,0),t+=a.length+1}return d.enabled&&d.log(new TextDecoder(`utf-8`).decode(r.slice(i,t))),0},environ_sizes_get(e,t){let n=new DataView(c.inst.exports.memory.buffer);n.setUint32(e,c.env.length,!0);let r=0;for(let e of c.env)r+=new TextEncoder().encode(e).length+1;return n.setUint32(t,r,!0),d.log(n.getUint32(e,!0),n.getUint32(t,!0)),0},environ_get(e,t){let n=new DataView(c.inst.exports.memory.buffer),r=new Uint8Array(c.inst.exports.memory.buffer),i=t;for(let i=0;i<c.env.length;i++){n.setUint32(e,t,!0),e+=4;let a=new TextEncoder().encode(c.env[i]);r.set(a,t),n.setUint8(t+a.length,0),t+=a.length+1}return d.enabled&&d.log(new TextDecoder(`utf-8`).decode(r.slice(i,t))),0},clock_res_get(e,t){let n;switch(e){case 1:n=5000n;break;case 0:n=1000000n;break;default:return 52}return new DataView(c.inst.exports.memory.buffer).setBigUint64(t,n,!0),0},clock_time_get(e,t,n){let r=new DataView(c.inst.exports.memory.buffer);if(e===0)r.setBigUint64(n,BigInt(new Date().getTime())*1000000n,!0);else if(e==1){let e;try{e=BigInt(Math.round(performance.now()*1e6))}catch{e=0n}r.setBigUint64(n,e,!0)}else r.setBigUint64(n,0n,!0);return 0},fd_advise(e,t,n,r){return c.fds[e]==null?8:0},fd_allocate(e,t,n){return c.fds[e]==null?8:c.fds[e].fd_allocate(t,n)},fd_close(e){if(c.fds[e]!=null){let t=c.fds[e].fd_close();return c.fds[e]=void 0,t}else return 8},fd_datasync(e){return c.fds[e]==null?8:c.fds[e].fd_sync()},fd_fdstat_get(e,t){if(c.fds[e]!=null){let{ret:n,fdstat:r}=c.fds[e].fd_fdstat_get();return r?.write_bytes(new DataView(c.inst.exports.memory.buffer),t),n}else return 8},fd_fdstat_set_flags(e,t){return c.fds[e]==null?8:c.fds[e].fd_fdstat_set_flags(t)},fd_fdstat_set_rights(e,t,n){return c.fds[e]==null?8:c.fds[e].fd_fdstat_set_rights(t,n)},fd_filestat_get(e,t){if(c.fds[e]!=null){let{ret:n,filestat:r}=c.fds[e].fd_filestat_get();return r?.write_bytes(new DataView(c.inst.exports.memory.buffer),t),n}else return 8},fd_filestat_set_size(e,t){return c.fds[e]==null?8:c.fds[e].fd_filestat_set_size(t)},fd_filestat_set_times(e,t,n,r){return c.fds[e]==null?8:c.fds[e].fd_filestat_set_times(t,n,r)},fd_pread(t,n,r,i,a){let o=new DataView(c.inst.exports.memory.buffer),s=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[t]!=null){let l=e.read_bytes_array(o,n,r),u=0;for(let e of l){let{ret:n,data:r}=c.fds[t].fd_pread(e.buf_len,i);if(n!=0)return o.setUint32(a,u,!0),n;if(s.set(r,e.buf),u+=r.length,i+=BigInt(r.length),r.length!=e.buf_len)break}return o.setUint32(a,u,!0),0}else return 8},fd_prestat_get(e,t){let n=new DataView(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let{ret:r,prestat:i}=c.fds[e].fd_prestat_get();return i?.write_bytes(n,t),r}else return 8},fd_prestat_dir_name(e,t,n){if(c.fds[e]!=null){let{ret:r,prestat:i}=c.fds[e].fd_prestat_get();if(i==null)return r;let a=i.inner.pr_name;return new Uint8Array(c.inst.exports.memory.buffer).set(a.slice(0,n),t),a.byteLength>n?37:0}else return 8},fd_pwrite(e,n,r,i,a){let o=new DataView(c.inst.exports.memory.buffer),s=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let l=t.read_bytes_array(o,n,r),u=0;for(let t of l){let n=s.slice(t.buf,t.buf+t.buf_len),{ret:r,nwritten:l}=c.fds[e].fd_pwrite(n,i);if(r!=0)return o.setUint32(a,u,!0),r;if(u+=l,i+=BigInt(l),l!=n.byteLength)break}return o.setUint32(a,u,!0),0}else return 8},fd_read(t,n,r,i){let a=new DataView(c.inst.exports.memory.buffer),o=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[t]!=null){let s=e.read_bytes_array(a,n,r),l=0;for(let e of s){let{ret:n,data:r}=c.fds[t].fd_read(e.buf_len);if(n!=0)return a.setUint32(i,l,!0),n;if(o.set(r,e.buf),l+=r.length,r.length!=e.buf_len)break}return a.setUint32(i,l,!0),0}else return 8},fd_readdir(e,t,n,r,i){let a=new DataView(c.inst.exports.memory.buffer),o=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let s=0;for(;;){let{ret:l,dirent:u}=c.fds[e].fd_readdir_single(r);if(l!=0)return a.setUint32(i,s,!0),l;if(u==null)break;if(n-s<u.head_length()){s=n;break}let d=new ArrayBuffer(u.head_length());if(u.write_head_bytes(new DataView(d),0),o.set(new Uint8Array(d).slice(0,Math.min(d.byteLength,n-s)),t),t+=u.head_length(),s+=u.head_length(),n-s<u.name_length()){s=n;break}u.write_name_bytes(o,t,n-s),t+=u.name_length(),s+=u.name_length(),r=u.d_next}return a.setUint32(i,s,!0),0}else return 8},fd_renumber(e,t){if(c.fds[e]!=null&&c.fds[t]!=null){let n=c.fds[t].fd_close();return n==0?(c.fds[t]=c.fds[e],c.fds[e]=void 0,0):n}else return 8},fd_seek(e,t,n,r){let i=new DataView(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let{ret:a,offset:o}=c.fds[e].fd_seek(t,n);return i.setBigInt64(r,o,!0),a}else return 8},fd_sync(e){return c.fds[e]==null?8:c.fds[e].fd_sync()},fd_tell(e,t){let n=new DataView(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let{ret:r,offset:i}=c.fds[e].fd_tell();return n.setBigUint64(t,i,!0),r}else return 8},fd_write(e,n,r,i){let a=new DataView(c.inst.exports.memory.buffer),o=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let s=t.read_bytes_array(a,n,r),l=0;for(let t of s){let n=o.slice(t.buf,t.buf+t.buf_len),{ret:r,nwritten:s}=c.fds[e].fd_write(n);if(r!=0)return a.setUint32(i,l,!0),r;if(l+=s,s!=n.byteLength)break}return a.setUint32(i,l,!0),0}else return 8},path_create_directory(e,t,n){let r=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let i=new TextDecoder(`utf-8`).decode(r.slice(t,t+n));return c.fds[e].path_create_directory(i)}else return 8},path_filestat_get(e,t,n,r,i){let a=new DataView(c.inst.exports.memory.buffer),o=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let s=new TextDecoder(`utf-8`).decode(o.slice(n,n+r)),{ret:l,filestat:u}=c.fds[e].path_filestat_get(t,s);return u?.write_bytes(a,i),l}else return 8},path_filestat_set_times(e,t,n,r,i,a,o){let s=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let l=new TextDecoder(`utf-8`).decode(s.slice(n,n+r));return c.fds[e].path_filestat_set_times(t,l,i,a,o)}else return 8},path_link(e,t,n,r,i,a,o){let s=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null&&c.fds[i]!=null){let l=new TextDecoder(`utf-8`).decode(s.slice(n,n+r)),u=new TextDecoder(`utf-8`).decode(s.slice(a,a+o)),{ret:d,inode_obj:f}=c.fds[e].path_lookup(l,t);return f==null?d:c.fds[i].path_link(u,f,!1)}else return 8},path_open(e,t,n,r,i,a,o,s,l){let u=new DataView(c.inst.exports.memory.buffer),f=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let p=new TextDecoder(`utf-8`).decode(f.slice(n,n+r));d.log(p);let{ret:m,fd_obj:h}=c.fds[e].path_open(t,p,i,a,o,s);if(m!=0)return m;c.fds.push(h);let g=c.fds.length-1;return u.setUint32(l,g,!0),0}else return 8},path_readlink(e,t,n,r,i,a){let o=new DataView(c.inst.exports.memory.buffer),s=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let l=new TextDecoder(`utf-8`).decode(s.slice(t,t+n));d.log(l);let{ret:u,data:f}=c.fds[e].path_readlink(l);if(f!=null){let e=new TextEncoder().encode(f);if(e.length>i)return o.setUint32(a,0,!0),8;s.set(e,r),o.setUint32(a,e.length,!0)}return u}else return 8},path_remove_directory(e,t,n){let r=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let i=new TextDecoder(`utf-8`).decode(r.slice(t,t+n));return c.fds[e].path_remove_directory(i)}else return 8},path_rename(e,t,n,r,i,a){let o=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null&&c.fds[r]!=null){let s=new TextDecoder(`utf-8`).decode(o.slice(t,t+n)),l=new TextDecoder(`utf-8`).decode(o.slice(i,i+a)),{ret:u,inode_obj:d}=c.fds[e].path_unlink(s);if(d==null)return u;if(u=c.fds[r].path_link(l,d,!0),u!=0&&c.fds[e].path_link(s,d,!0)!=0)throw`path_link should always return success when relinking an inode back to the original place`;return u}else return 8},path_symlink(e,t,n,r,i){let a=new Uint8Array(c.inst.exports.memory.buffer);return c.fds[n]==null?8:(new TextDecoder(`utf-8`).decode(a.slice(e,e+t)),new TextDecoder(`utf-8`).decode(a.slice(r,r+i)),58)},path_unlink_file(e,t,n){let r=new Uint8Array(c.inst.exports.memory.buffer);if(c.fds[e]!=null){let i=new TextDecoder(`utf-8`).decode(r.slice(t,t+n));return c.fds[e].path_unlink_file(i)}else return 8},poll_oneoff(e,t,n){if(n===0)return 28;if(n>1)return d.log(`poll_oneoff: only a single subscription is supported`),58;let r=new DataView(c.inst.exports.memory.buffer),i=a.read_bytes(r,e),s=i.eventtype,l=i.clockid,u=i.timeout;if(s!==0)return d.log(`poll_oneoff: only clock subscriptions are supported`),58;let f;if(l===1)f=()=>BigInt(Math.round(performance.now()*1e6));else if(l===0)f=()=>BigInt(new Date().getTime())*1000000n;else return 28;let p=i.flags&1?u:f()+u;for(;p>f(););return new o(i.userdata,0,s).write_bytes(r,t),0},proc_exit(e){throw new f(e)},proc_raise(e){throw`raised signal `+e},sched_yield(){},random_get(e,t){let n=new Uint8Array(c.inst.exports.memory.buffer).subarray(e,e+t);if(`crypto`in globalThis&&(typeof SharedArrayBuffer>`u`||!(c.inst.exports.memory.buffer instanceof SharedArrayBuffer)))for(let e=0;e<t;e+=65536)crypto.getRandomValues(n.subarray(e,e+65536));else for(let e=0;e<t;e++)n[e]=Math.random()*256|0},sock_recv(e,t,n){throw`sockets not supported`},sock_send(e,t,n){throw`sockets not supported`},sock_shutdown(e,t){throw`sockets not supported`},sock_accept(e,t){throw`sockets not supported`}}}};var m=class{fd_allocate(e,t){return 58}fd_close(){return 0}fd_fdstat_get(){return{ret:58,fdstat:null}}fd_fdstat_set_flags(e){return 58}fd_fdstat_set_rights(e,t){return 58}fd_filestat_get(){return{ret:58,filestat:null}}fd_filestat_set_size(e){return 58}fd_filestat_set_times(e,t,n){return 58}fd_pread(e,t){return{ret:58,data:new Uint8Array}}fd_prestat_get(){return{ret:58,prestat:null}}fd_pwrite(e,t){return{ret:58,nwritten:0}}fd_read(e){return{ret:58,data:new Uint8Array}}fd_readdir_single(e){return{ret:58,dirent:null}}fd_seek(e,t){return{ret:58,offset:0n}}fd_sync(){return 0}fd_tell(){return{ret:58,offset:0n}}fd_write(e){return{ret:58,nwritten:0}}path_create_directory(e){return 58}path_filestat_get(e,t){return{ret:58,filestat:null}}path_filestat_set_times(e,t,n,r,i){return 58}path_link(e,t,n){return 58}path_unlink(e){return{ret:58,inode_obj:null}}path_lookup(e,t){return{ret:58,inode_obj:null}}path_open(e,t,n,r,i,a){return{ret:54,fd_obj:null}}path_readlink(e){return{ret:58,data:null}}path_remove_directory(e){return 58}path_rename(e,t,n){return 58}path_unlink_file(e){return 58}},h=class e{static issue_ino(){return e.next_ino++}static root_ino(){return 0n}constructor(){this.ino=e.issue_ino()}};h.next_ino=1n;var g=class extends m{fd_allocate(e,t){if(!(this.file.size>e+t)){let n=new Uint8Array(Number(e+t));n.set(this.file.data,0),this.file.data=n}return 0}fd_fdstat_get(){return{ret:0,fdstat:new r(4,0)}}fd_filestat_set_size(e){if(this.file.size>e)this.file.data=new Uint8Array(this.file.data.buffer.slice(0,Number(e)));else{let t=new Uint8Array(Number(e));t.set(this.file.data,0),this.file.data=t}return 0}fd_read(e){let t=this.file.data.slice(Number(this.file_pos),Number(this.file_pos+BigInt(e)));return this.file_pos+=BigInt(t.length),{ret:0,data:t}}fd_pread(e,t){return{ret:0,data:this.file.data.slice(Number(t),Number(t+BigInt(e)))}}fd_seek(e,t){let n;switch(t){case 0:n=e;break;case 1:n=this.file_pos+e;break;case 2:n=BigInt(this.file.data.byteLength)+e;break;default:return{ret:28,offset:0n}}return n<0?{ret:28,offset:0n}:(this.file_pos=n,{ret:0,offset:this.file_pos})}fd_tell(){return{ret:0,offset:this.file_pos}}fd_write(e){if(this.file.readonly)return{ret:8,nwritten:0};if(this.file_pos+BigInt(e.byteLength)>this.file.size){let t=this.file.data;this.file.data=new Uint8Array(Number(this.file_pos+BigInt(e.byteLength))),this.file.data.set(t)}return this.file.data.set(e,Number(this.file_pos)),this.file_pos+=BigInt(e.byteLength),{ret:0,nwritten:e.byteLength}}fd_pwrite(e,t){if(this.file.readonly)return{ret:8,nwritten:0};if(t+BigInt(e.byteLength)>this.file.size){let n=this.file.data;this.file.data=new Uint8Array(Number(t+BigInt(e.byteLength))),this.file.data.set(n)}return this.file.data.set(e,Number(t)),{ret:0,nwritten:e.byteLength}}fd_filestat_get(){return{ret:0,filestat:this.file.stat()}}constructor(e){super(),this.file_pos=0n,this.file=e}},_=class extends m{fd_seek(e,t){return{ret:8,offset:0n}}fd_tell(){return{ret:8,offset:0n}}fd_allocate(e,t){return 8}fd_fdstat_get(){return{ret:0,fdstat:new r(3,0)}}fd_readdir_single(e){if(d.enabled&&(d.log(`readdir_single`,e),d.log(e,this.dir.contents.keys())),e==0n)return{ret:0,dirent:new n(1n,this.dir.ino,`.`,3)};if(e==1n)return{ret:0,dirent:new n(2n,this.dir.parent_ino(),`..`,3)};if(e>=BigInt(this.dir.contents.size)+2n)return{ret:0,dirent:null};let[t,r]=Array.from(this.dir.contents.entries())[Number(e-2n)];return{ret:0,dirent:new n(e+1n,r.ino,t,r.stat().filetype)}}path_filestat_get(e,t){let{ret:n,path:r}=b.from(t);if(r==null)return{ret:n,filestat:null};let{ret:i,entry:a}=this.dir.get_entry_for_path(r);return a==null?{ret:i,filestat:null}:{ret:0,filestat:a.stat()}}path_lookup(e,t){let{ret:n,path:r}=b.from(e);if(r==null)return{ret:n,inode_obj:null};let{ret:i,entry:a}=this.dir.get_entry_for_path(r);return a==null?{ret:i,inode_obj:null}:{ret:0,inode_obj:a}}path_open(e,t,n,r,i,a){let{ret:o,path:s}=b.from(t);if(s==null)return{ret:o,fd_obj:null};let{ret:c,entry:l}=this.dir.get_entry_for_path(s);if(l==null){if(c!=44)return{ret:c,fd_obj:null};if((n&1)==1){let{ret:e,entry:r}=this.dir.create_entry_for_path(t,(n&2)==2);if(r==null)return{ret:e,fd_obj:null};l=r}else return{ret:44,fd_obj:null}}else if((n&4)==4)return{ret:20,fd_obj:null};return(n&2)==2&&l.stat().filetype!==3?{ret:54,fd_obj:null}:l.path_open(n,r,a)}path_create_directory(e){return this.path_open(0,e,3,0n,0n,0).ret}path_link(e,t,n){let{ret:r,path:i}=b.from(e);if(i==null)return r;if(i.is_dir)return 44;let{ret:a,parent_entry:o,filename:s,entry:c}=this.dir.get_parent_dir_and_entry_for_path(i,!0);if(o==null||s==null)return a;if(c!=null){let e=t.stat().filetype==3,r=c.stat().filetype==3;if(e&&r)if(n&&c instanceof x){if(c.contents.size!=0)return 55}else return 20;else if(e&&!r)return 54;else if(!e&&r)return 31;else if(!(t.stat().filetype==4&&c.stat().filetype==4))return 20}return!n&&t.stat().filetype==3?63:(o.contents.set(s,t),0)}path_unlink(e){let{ret:t,path:n}=b.from(e);if(n==null)return{ret:t,inode_obj:null};let{ret:r,parent_entry:i,filename:a,entry:o}=this.dir.get_parent_dir_and_entry_for_path(n,!0);return i==null||a==null?{ret:r,inode_obj:null}:o==null?{ret:44,inode_obj:null}:(i.contents.delete(a),{ret:0,inode_obj:o})}path_unlink_file(e){let{ret:t,path:n}=b.from(e);if(n==null)return t;let{ret:r,parent_entry:i,filename:a,entry:o}=this.dir.get_parent_dir_and_entry_for_path(n,!1);return i==null||a==null||o==null?r:o.stat().filetype===3?31:(i.contents.delete(a),0)}path_remove_directory(e){let{ret:t,path:n}=b.from(e);if(n==null)return t;let{ret:r,parent_entry:i,filename:a,entry:o}=this.dir.get_parent_dir_and_entry_for_path(n,!1);return i==null||a==null||o==null?r:!(o instanceof x)||o.stat().filetype!==3?54:o.contents.size===0?i.contents.delete(a)?0:44:55}fd_filestat_get(){return{ret:0,filestat:this.dir.stat()}}fd_filestat_set_size(e){return 8}fd_read(e){return{ret:8,data:new Uint8Array}}fd_pread(e,t){return{ret:8,data:new Uint8Array}}fd_write(e){return{ret:8,nwritten:0}}fd_pwrite(e,t){return{ret:8,nwritten:0}}constructor(e){super(),this.dir=e}},v=class extends _{fd_prestat_get(){return{ret:0,prestat:c.dir(this.prestat_name)}}constructor(e,t){super(new x(t)),this.prestat_name=e}},y=class extends h{path_open(e,t,n){if(this.readonly&&(t&BigInt(64))==BigInt(64))return{ret:63,fd_obj:null};if((e&8)==8){if(this.readonly)return{ret:63,fd_obj:null};this.data=new Uint8Array([])}let r=new g(this);return n&1&&r.fd_seek(0n,2),{ret:0,fd_obj:r}}get size(){return BigInt(this.data.byteLength)}stat(){return new i(this.ino,4,this.size)}constructor(e,t){super(),this.data=new Uint8Array(e),this.readonly=!!t?.readonly}};let b=class e{static from(t){let n=new e;if(n.is_dir=t.endsWith(`/`),t.startsWith(`/`))return{ret:76,path:null};if(t.includes(`\0`))return{ret:28,path:null};for(let e of t.split(`/`))if(!(e===``||e===`.`)){if(e===`..`){if(n.parts.pop()==null)return{ret:76,path:null};continue}n.parts.push(e)}return{ret:0,path:n}}to_path_string(){let e=this.parts.join(`/`);return this.is_dir&&(e+=`/`),e}constructor(){this.parts=[],this.is_dir=!1}};var x=class e extends h{parent_ino(){return this.parent==null?h.root_ino():this.parent.ino}path_open(e,t,n){return{ret:0,fd_obj:new _(this)}}stat(){return new i(this.ino,3,0n)}get_entry_for_path(t){let n=this;for(let r of t.parts){if(!(n instanceof e))return{ret:54,entry:null};let t=n.contents.get(r);if(t!==void 0)n=t;else return d.log(r),{ret:44,entry:null}}return t.is_dir&&n.stat().filetype!=3?{ret:54,entry:null}:{ret:0,entry:n}}get_parent_dir_and_entry_for_path(t,n){let r=t.parts.pop();if(r===void 0)return{ret:28,parent_entry:null,filename:null,entry:null};let{ret:i,entry:a}=this.get_entry_for_path(t);if(a==null)return{ret:i,parent_entry:null,filename:null,entry:null};if(!(a instanceof e))return{ret:54,parent_entry:null,filename:null,entry:null};let o=a.contents.get(r);return o===void 0?n?{ret:0,parent_entry:a,filename:r,entry:null}:{ret:44,parent_entry:null,filename:null,entry:null}:t.is_dir&&o.stat().filetype!=3?{ret:54,parent_entry:null,filename:null,entry:null}:{ret:0,parent_entry:a,filename:r,entry:o}}create_entry_for_path(t,n){let{ret:r,path:i}=b.from(t);if(i==null)return{ret:r,entry:null};let{ret:a,parent_entry:o,filename:s,entry:c}=this.get_parent_dir_and_entry_for_path(i,!0);if(o==null||s==null)return{ret:a,entry:null};if(c!=null)return{ret:20,entry:null};d.log(`create`,i);let l;return l=n?new e(new Map):new y(new ArrayBuffer(0)),o.contents.set(s,l),c=l,{ret:0,entry:c}}constructor(t){super(),this.parent=null,t instanceof Array?this.contents=new Map(t):this.contents=t;for(let t of this.contents.values())t instanceof e&&(t.parent=this)}};const S=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,C=e=>S(e?.buffer),w=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const T=new TextDecoder,E=e=>e instanceof Int32Array?e:new Int32Array(e),D=e=>new Uint8Array(e.buffer,e.byteOffset+w,e.byteLength-w),O=e=>{let t=E(e),n=Atomics.load(t,1);if(n===-1)return null;let r=D(t);return T.decode(r.slice(0,n))},k=(e,t)=>{if(!e||!C(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return O(e)},A=new TextDecoder,j=globalThis.fetch.bind(globalThis),M=globalThis.XMLHttpRequest;let N=null,ee=!1,te=0;const P=new Map,ne=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},re=e=>N?typeof e==`string`?new URL(e,N.baseUrl).href:e instanceof URL?e.href:e.url:null,ie=e=>!N||!e.startsWith(N.baseUrl)?null:e.slice(N.baseUrl.length),ae=e=>ie(e)!==null,oe=async e=>{let t=++te;return await new Promise((n,r)=>{P.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},se=async(e,t)=>{let n=await j(e);if(!n.ok)throw Error(`Failed to load ${t}: ${n.status}`);let r=Number(n.headers.get(`content-length`)||0)||void 0,i=n.headers.get(`content-type`)||void 0;if(!n.body){let e=new Uint8Array(await n.arrayBuffer());return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:r??e.byteLength}}),{bytes:e,mimeType:i}}let a=n.body.getReader(),o=0,s=[];for(;;){let{done:e,value:n}=await a.read();if(e)break;if(!n)continue;let i=Uint8Array.from(n);s.push(i),o+=i.byteLength,self.postMessage({assetProgress:{asset:t,loaded:o,total:r}})}let c=new Uint8Array(o),l=0;for(let e of s)c.set(e,l),l+=e.byteLength;return self.postMessage({assetProgress:{asset:t,loaded:o,total:r??o}}),{bytes:c,mimeType:i}};async function ce(e){let t=ie(e);if(!t||!N)throw Error(`Untracked runtime asset request`);return N.useAssetBridge?await oe(t):await se(e,t)}function le(e){return new Response(ne(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function ue(){if(M===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=re(t);if(!n||!ae(n)){let r=n||(t instanceof URL?t.href:String(t));this.native=new M,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await ce(this.url),t=ne(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=A.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function de(){ee||(ee=!0,globalThis.fetch=(async(e,t)=>{let n=re(e);return!n||!ae(n)?j(e,t):le(await ce(n))}),ue())}function fe(e){N=e,de()}function pe(e){let t=e?.assetResponse;if(!t)return!1;let n=P.get(t.id);return n?(P.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}function F(e,...t){let n={};for(let r of t)n[r]=(e[r]||(()=>0)).bind(e);return n}function I(e,t,n=-1){let r=n===-1?e.length:t+n,i=``;for(let n=t;n<r&&e[n];++n)i+=String.fromCharCode(e[n]);return i}function me(e,t,n=-1){let r=n===-1?e.length:t+n,i=[];for(let n=t;n<r&&e[n];++n)i.push(e[n]);return new TextDecoder().decode(Uint8Array.from(i))}function he(e,t,n){return parseInt(I(e,t,n),8)}var ge=class{memory;view;buffer;u8;u32;constructor(e){this.memory=e,this.buffer=e.buffer,this.view=new DataView(this.buffer),this.u8=new Uint8Array(this.buffer),this.u32=new Uint32Array(this.buffer)}check(){this.buffer.byteLength===0&&(this.buffer=this.memory.buffer,this.view=new DataView(this.buffer),this.u8=new Uint8Array(this.buffer),this.u32=new Uint32Array(this.buffer))}read8(e){return this.u8[e]}read32(e){return this.u32[e>>2]}readInt32(e){return this.view.getInt32(e,!0)}readFloat32(e){return this.view.getFloat32(e,!0)}readFloat64(e){return this.view.getFloat64(e,!0)}readStr(e,t){return I(this.u8,e,t)}readStrR(e,t){return me(this.u8,e,t)}write8(e,t){this.u8[e]=t}write32(e,t){this.u32[e>>2]=t}write64(e,t,n=0){this.write32(e,t),this.write32(e+4,n)}writeStr(e,t){return e+=this.write(e,t),this.write8(e,0),t.length+1}writeUint8(e,t){return new Uint8Array(this.buffer,e,t.length).set(t),t.length}write(e,t){return t instanceof ArrayBuffer||t instanceof SharedArrayBuffer?this.writeUint8(e,new Uint8Array(t)):typeof t==`string`?this.writeUint8(e,t.split(``).map(e=>e.charCodeAt(0))):this.writeUint8(e,t)}};const L={},R={},_e=e=>e.byteLength>=2&&e[0]===31&&e[1]===139;function ve(e){let t;try{t=new URL(e,typeof location<`u`?location.href:void 0)}catch{throw Error(`Runtime asset URL must be absolute outside a browser document`)}if(t.protocol!==`http:`&&t.protocol!==`https:`)throw Error(`Runtime assets must use HTTP(S)`);return t}async function ye(e,t){let n=+(e.headers.get(`Content-Length`)||0);if(!e.body){let n=new Uint8Array(await e.arrayBuffer());return t?.set?.(1),n}let r=e.body.getReader(),i=[],a=0;for(;;){let{done:e,value:o}=await r.read();if(e)break;if(!o)continue;let s=Uint8Array.from(o);i.push(s),a+=s.byteLength,n>0&&t?.set?.(a/n)}let o=new Uint8Array(a),s=0;for(let e of i)o.set(e,s),s+=e.byteLength;return o}async function be(e,t=`runtime asset`){if(!_e(e))return e;if(typeof DecompressionStream!=`function`)throw Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);try{let t=Uint8Array.from(e),n=new ReadableStream({start(e){e.enqueue(t),e.close()}}),r=new DecompressionStream(`gzip`),i=n.pipeThrough({readable:r.readable,writable:r.writable});return new Uint8Array(await new Response(i).arrayBuffer())}catch(e){throw Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}async function xe(e,t,n){if(!e.body){let r=await be(new Uint8Array(await e.arrayBuffer()),t);return n?.set?.(1),r}let r=+(e.headers.get(`Content-Length`)||0),i=e.body.getReader(),a=[],o=0,s=0;for(;o<2;){let{done:e,value:t}=await i.read();if(e)break;if(!t)continue;let c=Uint8Array.from(t);a.push(c),o+=c.byteLength,s+=c.byteLength,r>0&&n?.set?.(Math.min(s/r,1))}let c,l;for(let e of a){for(let t of e)if(c===void 0?c=t:l===void 0&&(l=t),l!==void 0)break;if(l!==void 0)break}let u=0,d=new ReadableStream({async pull(e){if(u<a.length){e.enqueue(a[u++]);return}let{done:t,value:o}=await i.read();if(t){e.close();return}if(!o)return;let c=Uint8Array.from(o);s+=c.byteLength,r>0&&n?.set?.(Math.min(s/r,1)),e.enqueue(c)},cancel(e){return i.cancel(e)}}),f=d;if(c===31&&l===139){if(typeof DecompressionStream!=`function`)throw await i.cancel(),Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);let e=new DecompressionStream(`gzip`);f=d.pipeThrough({readable:e.readable,writable:e.writable})}try{let e=new Uint8Array(await new Response(f).arrayBuffer());return n?.set?.(1),e}catch(e){throw Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}async function Se(e){let{unzipSync:t}=await import(`./chunks/BR24SaiU.js`),n=t(e);for(let[e,t]of Object.entries(n))if(!e.endsWith(`/`))return t;throw Error(`No entry found`)}const Ce=async(e,t)=>{R[e]||(R[e]=(async()=>{let n=ve(e),r=await fetch(n);if(!r.ok)throw Error(`Failed to load runtime asset ${n}: ${r.status}`);if(n.pathname.endsWith(`.gz`))return await xe(r,n,t);let i=await ye(r,t);return n.pathname.endsWith(`.zip`)?await Se(i):i})().catch(t=>{throw delete R[e],t}));let n=await R[e];return t?.set?.(1),Uint8Array.from(n)};async function we(e,t){return L[e]?L[e]:L[e]=WebAssembly.compile(await Ce(e,t))}function Te(e,t){return WebAssembly.instantiate(e,t)}var Ee=class extends Error{code;constructor(e){super(`process exited with code ${e}.`),this.code=e}},De=class extends Error{constructor(e,t){super(`${e}.${t} not implemented.`)}},Oe=class extends Error{constructor(e=`abort`){super(e)}},ke=class extends Error{constructor(e){super(e)}};function Ae(e){if(!e)throw new ke(`assertion failed.`)}const je=[`&&`,`||`,`==`,`!=`,`<=`,`>=`,`+`,`-`,`*`,`/`,`%`,`<`,`>`,`!`],z=e=>!!e&&typeof e==`object`&&!Array.isArray(e)&&e.__debugExpressionKind===`array`,Me=e=>!!e&&typeof e==`object`&&!Array.isArray(e)&&e.__debugExpressionKind===`object`,B=(e,t)=>{let n=e[t];if(n!==`'`&&n!==`"`)throw Error(`expected quoted string`);let r=t+1,i=``;for(;r<e.length;){let t=e[r];if(!t)break;if(t===`\\`){let t=e[r+1];if(!t)throw Error(`unterminated string literal`);t===`n`?i+=`
`:t===`r`?i+=`\r`:t===`t`?i+=`	`:i+=t,r+=2;continue}if(t===n)return{value:i,next:r+1};i+=t,r+=1}throw Error(`unterminated string literal`)},Ne=e=>{let t=[];for(let n=0;n<e.length;){let r=e[n];if(!r)break;if(/\s/.test(r)){n+=1;continue}if(r===`(`||r===`)`){t.push({type:`paren`,value:r}),n+=1;continue}if(r===`[`||r===`]`){t.push({type:`bracket`,value:r}),n+=1;continue}if(r===`.`){t.push({type:`dot`}),n+=1;continue}let i=je.find(t=>e.startsWith(t,n));if(i){t.push({type:`operator`,value:i}),n+=i.length;continue}if(r===`'`||r===`"`){let r=B(e,n);t.push({type:`string`,value:r.value}),n=r.next;continue}let a=e.slice(n).match(/^\d+(?:\.\d+)?/);if(a?.[0]){t.push({type:`number`,value:a[0]}),n+=a[0].length;continue}let o=e.slice(n).match(/^[A-Za-z_]\w*/);if(o?.[0]){o[0]===`true`||o[0]===`false`||o[0]===`True`||o[0]===`False`?t.push({type:`boolean`,value:o[0]===`true`||o[0]===`True`}):o[0]===`null`||o[0]===`None`?t.push({type:`null`}):o[0]===`and`?t.push({type:`operator`,value:`&&`}):o[0]===`or`?t.push({type:`operator`,value:`||`}):o[0]===`not`?t.push({type:`operator`,value:`!`}):t.push({type:`identifier`,value:o[0]}),n+=o[0].length;continue}throw Error(`unsupported token near "${e.slice(n)}"`)}return t},V=(e,t=0)=>{let n=t;for(;/\s/.test(e[n]||``);)n+=1;let r=e[n];if(r===`[`){n+=1;let t=[];for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`]`)return{value:t,next:n+1};if(e.startsWith(`...`,n)){for(t.truncated=!0,n+=3;/\s/.test(e[n]||``);)n+=1;if(e[n]===`]`)return{value:t,next:n+1};throw Error(`unsupported array preview`)}let r=V(e,n);for(t.push(r.value),n=r.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`]`)return{value:t,next:n+1};throw Error(`unsupported array preview`)}}if(r===`(`){n+=1;let t=[];for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`)`)return{value:t,next:n+1};if(e.startsWith(`...`,n)){for(t.truncated=!0,n+=3;/\s/.test(e[n]||``);)n+=1;if(e[n]===`)`)return{value:t,next:n+1};throw Error(`unsupported tuple preview`)}let r=V(e,n);for(t.push(r.value),n=r.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`)`)return{value:t,next:n+1};throw Error(`unsupported tuple preview`)}}if(r===`{`){n+=1;let t={};for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`}`)return{value:t,next:n+1};if(e.startsWith(`...`,n))throw Error(`unavailable`);let r=``;if(e[n]===`'`||e[n]===`"`){let t=B(e,n);r=t.value,n=t.next}else{let t=e.slice(n).match(/^[A-Za-z_]\w*/)?.[0];if(!t)throw Error(`unsupported object preview`);r=t,n+=t.length}for(;/\s/.test(e[n]||``);)n+=1;if(e[n]!==`:`)throw Error(`unsupported object preview`);n+=1;let i=V(e,n);for(t[r]=i.value,n=i.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`}`)return{value:t,next:n+1};throw Error(`unsupported object preview`)}}if(r===`'`||r===`"`)return B(e,n);if(e.startsWith(`true`,n))return{value:!0,next:n+4};if(e.startsWith(`false`,n))return{value:!1,next:n+5};if(e.startsWith(`True`,n))return{value:!0,next:n+4};if(e.startsWith(`False`,n))return{value:!1,next:n+5};if(e.startsWith(`null`,n)||e.startsWith(`None`,n))return{value:null,next:n+4};let i=e.slice(n).match(/^-?\d+(?:\.\d+)?/);if(i?.[0])return{value:Number(i[0]),next:n+i[0].length};throw Error(`unsupported preview`)},Pe=e=>{let t=e.trim();if(!t||t===`?`)throw Error(`unavailable`);if(t===`true`||t===`false`||t===`True`||t===`False`)return t===`true`||t===`True`;if(t===`null`||t===`None`)return null;let n=Number(t);if(!Number.isNaN(n))return n;if(t.startsWith(`[`)||t.startsWith(`(`)||t.startsWith(`{`)||t.startsWith(`'`)||t.startsWith(`"`)){let e=V(t);if(t.slice(e.next).trim())throw Error(`unsupported preview`);return e.value}throw Error(`unsupported preview`)},Fe=e=>`'${e.replaceAll(`\\`,`\\\\`).replaceAll(`'`,`\\'`).replaceAll(`
`,`\\n`).replaceAll(`\r`,`\\r`).replaceAll(`	`,`\\t`)}'`,H=(e,t,n)=>{if(e===null)return`null`;if(typeof e==`number`||typeof e==`boolean`)return`${e}`;if(typeof e==`string`)return t?Fe(e):e;if(n>=4)return`...`;if(Array.isArray(e)){let t=Math.min(e.length,8);return`[${e.slice(0,t).map(e=>H(e,!0,n+1)).join(`, `)}${e.truncated||e.length>t?`, ...`:``}]`}if(z(e)){let t=e.keys?.()||[],r=Math.min(t.length||e.length||0,8),i=[];for(let a=0;a<r;a+=1){let r=t[a]??a;i.push(H(e.get(r),!0,n+1))}let a=e.truncated||e.length!=null&&e.length>r;return`[${i.join(`, `)}${a?`, ...`:``}]`}if(Me(e)){let t=e.keys?.()||[],r=Math.min(t.length,8);return`{${t.slice(0,r).map(t=>`${t}: ${H(e.get(t),!0,n+1)}`).join(`, `)}${t.length>r?`, ...`:``}}`}let r=Object.keys(e),i=Math.min(r.length,8);return`{${r.slice(0,i).map(t=>`${t}: ${H(e[t],!0,n+1)}`).join(`, `)}${r.length>i?`, ...`:``}}`},Ie=e=>H(e,!1,0),Le=(e,t)=>{let n=e.trim();if(!n)throw Error(`empty expression`);let r=Ne(n),i=new Map,a=e=>{if(i.has(e))return i.get(e);let n=t(e);return i.set(e,n),n},o=(e,t)=>{if(!Number.isInteger(t))throw Error(`unsupported index access`);if(Array.isArray(e)){if(t<0||t>=e.length)throw Error(`unavailable`);return e[t]}if(z(e)){if(e.length!=null&&(t<0||t>=e.length))throw Error(`unavailable`);return e.get(t)}throw Error(`unsupported index access`)},s=(e,t)=>{if(Array.isArray(e)||z(e)||!e)throw Error(`unsupported member access`);if(Me(e)){if(!e.has(t))throw Error(`unavailable`);return e.get(t)}if(typeof e!=`object`||!Object.hasOwn(e,t))throw Error(`unavailable`);return e[t]},c=0,l=!0,u=e=>{let t=l;l=!1;try{return e()}finally{l=t}},d=()=>{let e=r[c];if(!e)throw Error(`unexpected end of expression`);if(e.type===`number`)return c+=1,Number(e.value);if(e.type===`boolean`)return c+=1,e.value;if(e.type===`null`)return c+=1,null;if(e.type===`string`)return c+=1,e.value;if(e.type===`identifier`){c+=1;let t=l?a(e.value):null;for(;;){let e=r[c];if(e?.type===`bracket`&&e.value===`[`){c+=1;let e=Number(v()),n=r[c];if(!n||n.type!==`bracket`||n.value!==`]`)throw Error(`missing closing bracket`);c+=1,t=l?o(t,e):null;continue}if(e?.type===`dot`){c+=1;let e=r[c];if(!e||e.type!==`identifier`)throw Error(`missing property name`);c+=1,t=l?s(t,e.value):null;continue}break}return t}if(e.type===`paren`&&e.value===`(`){c+=1;let e=v(),t=r[c];if(!t||t.type!==`paren`||t.value!==`)`)throw Error(`missing closing parenthesis`);return c+=1,e}throw Error(`expected value`)},f=()=>{let e=r[c];return e?.type===`operator`&&e.value===`!`?(c+=1,!f()):e?.type===`operator`&&e.value===`-`?(c+=1,-Number(f())):e?.type===`operator`&&e.value===`+`?(c+=1,Number(f())):d()},p=()=>{let e=f();for(;;){let t=r[c];if(t?.type!==`operator`||![`*`,`/`,`%`].includes(t.value))return e;c+=1;let n=f();t.value===`*`&&(e=Number(e)*Number(n)),t.value===`/`&&(e=Number(e)/Number(n)),t.value===`%`&&(e=Number(e)%Number(n))}},m=()=>{let e=p();for(;;){let t=r[c];if(t?.type!==`operator`||![`+`,`-`].includes(t.value))return e;c+=1;let n=p();t.value===`+`&&(e=typeof e==`string`||typeof n==`string`?`${e??`null`}${n??`null`}`:Number(e)+Number(n)),t.value===`-`&&(e=Number(e)-Number(n))}},h=()=>{let e=m();for(;;){let t=r[c];if(t?.type!==`operator`||![`<`,`<=`,`>`,`>=`].includes(t.value))return e;c+=1;let n=m(),i=typeof e==`string`&&typeof n==`string`?e:Number(e),a=typeof e==`string`&&typeof n==`string`?n:Number(n);t.value===`<`&&(e=i<a),t.value===`<=`&&(e=i<=a),t.value===`>`&&(e=i>a),t.value===`>=`&&(e=i>=a)}},g=()=>{let e=h();for(;;){let t=r[c];if(t?.type!==`operator`||![`==`,`!=`].includes(t.value))return e;c+=1;let n=h();t.value===`==`&&(e=e===n),t.value===`!=`&&(e=e!==n)}},_=()=>{let e=g();for(;;){let t=r[c];if(!t||t.type!==`operator`||t.value!==`&&`)break;c+=1;let n=l&&e?g():u(g);l&&(e=!!e&&!!n)}return e},v=()=>{let e=_();for(;;){let t=r[c];if(!t||t.type!==`operator`||t.value!==`||`)break;c+=1;let n=l&&!e?_():u(_);l&&(e=!!e||!!n)}return e},y=v();if(c!==r.length)throw Error(`unexpected trailing tokens`);return Ie(y)},Re=Int32Array.BYTES_PER_ELEMENT*2,U=new TextEncoder,ze=new TextDecoder,Be=e=>e instanceof Int32Array?e:new Int32Array(e),Ve=e=>new Uint8Array(e.buffer,e.byteOffset+Re,e.byteLength-Re),He=(e,t)=>{let n=U.encode(e);if(n.length<=t)return{bytes:n,rest:``};let r=0,i=e.length;for(;r<i;){let n=Math.ceil((r+i)/2);U.encode(e.slice(0,n)).length<=t?r=n:i=n-1}let a=e.slice(0,r);return{bytes:U.encode(a),rest:e.slice(r)}},Ue=(e,t)=>{if(!e.length)return!1;let n=Be(t),r=Ve(n),{bytes:i,rest:a}=He(e[0]||``,r.length);return r.fill(0),r.set(i),Atomics.store(n,1,i.length),Atomics.add(n,0,1),Atomics.notify(n,0),a?e[0]=a:e.shift(),!0},We=e=>{let t=Be(e),n=Atomics.load(t,1);if(n===-1)return null;let r=Ve(t);return ze.decode(r.slice(0,n))};var Ge=class{ready;mem=null;memfs;instance=null;exports;trace=()=>{};debugSession;useJsReadOverlay=!1;useJsSourceReadOverlay=!1;argv;environ;handles=new Map;nextHandle=1024;syntheticFileHandles=new Set;nextSyntheticInode=1;syntheticInodes=new Map;readFileHandles=new Map;writeFileHandles=new Map;constructor(e,t,n,...r){let i=r.at(-1),a=i&&typeof i==`object`?r.pop():{};this.argv=[n,...r],this.environ={USER:`wasm-clang`},this.memfs=t,this.useJsReadOverlay=n===`wasm-ld`||n===`ld.lld`||n===`lld`,this.useJsSourceReadOverlay=n===`clang`||n===`clang++`||n===`cobc`;let o=F(this,`__wasm_idle_debug_enter`,`__wasm_idle_debug_leave`,`__wasm_idle_debug_line`,`__wasm_idle_debug_value_num`,`__wasm_idle_debug_value_bool`,`__wasm_idle_debug_value_addr`,`__wasm_idle_debug_value_text`),s={...F(this,`proc_exit`,`environ_sizes_get`,`environ_get`,`args_sizes_get`,`args_get`,`random_get`,`clock_time_get`,`poll_oneoff`,`fd_filestat_set_times`,`path_filestat_set_times`,`sock_accept`,`sock_recv`,`sock_send`,`sock_shutdown`,`path_link`,`path_rename`),...this.memfs.exports,...F(this,`path_open`,`path_filestat_get`,`path_readlink`,`path_unlink_file`,`fd_fdstat_get`,`fd_fdstat_set_flags`,`fd_filestat_get`,`fd_filestat_set_size`,`fd_datasync`,`fd_read`,`fd_pread`,`fd_seek`,`fd_tell`,`fd_write`,`fd_close`)},c=a.extraImports?.env||{};this.ready=Te(e,{...a.extraImports,wasi_unstable:s,wasi_snapshot_preview1:s,env:{...c,...o}}).then(e=>{this.instance=e,a.instanceRef&&(a.instanceRef.current=e),this.exports=this.instance.exports,this.mem=new ge(this.exports.memory),this.memfs.hostMem=this.mem})}async run(){await this.ready,this.trace(`start(argv=${JSON.stringify(this.argv)}, exports=${JSON.stringify(Object.keys(this.exports||{}))})`);try{this.exports._start()}catch(e){let t=!0;if(e instanceof Ee){if(this.trace(`proc_exit(code=${e.code})`),e.code===789514)return this.trace(`allow_rAF_after_exit`),!0;if(this.trace(`disallow_rAF_after_exit(code=${e.code})`),e.code==0)return!1;t=!1}e instanceof De&&this.trace(`not_implemented(${e.message})`);let n=`\x1b[91mError: ${e.message}`;throw t&&(n+=`\n${e.stack}`),n+=`\x1B[0m
`,this.memfs.stdout(n),e}this.trace(`start() returned without proc_exit`)}proc_exit(e){throw this.trace(`proc_exit_throw(code=${e})`),new Ee(e)}toNumber(e){return typeof e==`bigint`?Number(e):e}writeU32(e,t){this.mem.view.setUint32(e,t>>>0,!0)}writeU64(e,t){let n=BigInt(t);this.mem.view.setUint32(e,Number(n&4294967295n),!0),this.mem.view.setUint32(e+4,Number(n>>32n&4294967295n),!0)}readMemfsFile(e){let t=[e,e.replace(/^\/+/,``),e.replace(/^\.\//,``),e.replace(/^\/+/,``).replace(/^\.\//,``)];for(let e of t)if(this.memfs.hasFile(e))try{return Uint8Array.from(this.memfs.getFileContents(e))}catch{}return null}shouldUseJsReadForPath(e){return this.useJsReadOverlay?!0:this.useJsSourceReadOverlay}syntheticInodeForPath(e){let t=e.replace(/^\/+/,``).replace(/^\.\//,``)||e,n=this.syntheticInodes.get(t);return n||(n=this.nextSyntheticInode++,this.syntheticInodes.set(t,n)),n}copyFileToIovs(e,t,n,r,i){this.mem.check();let a=0;for(let i=0;i<r;i+=1){let r=this.mem.read32(n);n+=4;let i=this.mem.read32(n);if(n+=4,i<=0)continue;let o=Math.max(0,e.length-t),s=Math.min(i,o);if(s>0&&(this.mem.write(r,e.subarray(t,t+s)),t+=s,a+=s),s<i)break}return this.writeU32(i,a),{copied:a,position:t}}writeRegularFileStat(e,t,n){this.mem.check(),this.writeU64(e,1),this.writeU64(e+8,this.syntheticInodeForPath(n)),this.mem.write8(e+16,4),this.writeU64(e+24,1),this.writeU64(e+32,t),this.writeU64(e+40,0),this.writeU64(e+48,0),this.writeU64(e+56,0)}seekPosition(e,t,n,r){let i=this.toNumber(n);return r===0?Math.max(0,i):r===1?Math.max(0,e+i):r===2?Math.max(0,t+i):null}ensureWriteCapacity(e,t){if(e.contents.length>=t)return;let n=Math.max(1024,e.contents.length);for(;n<t;)n*=2;let r=new Uint8Array(n);r.set(e.contents.subarray(0,e.size)),e.contents=r}atomicOutputTarget(e){let t=e.match(/^(.+)-[0-9a-f]+(\.[^.]+)\.tmp$/);return t?`${t[1]}${t[2]}`:null}storeFileContents(e,t){if(this.useJsReadOverlay||this.useJsSourceReadOverlay){this.memfs.setFile(e,t);return}this.memfs.addFile(e,t)}path_open(e,t,n,r,i,a,o,s,c){this.mem.check();let l=this.mem.readStr(n,r),u=this.toNumber(a),d=(u&64)!=0||(i&9)!=0;this.trace(`path_open_request(path=${JSON.stringify(l)}, rights=${u}, oflags=${i}, write=${d})`);let f=!d&&this.shouldUseJsReadForPath(l)&&u&2?this.readMemfsFile(l):null;if(!d&&this.shouldUseJsReadForPath(l)&&u&2&&!f)return this.trace(`path_open_read_missing(path=${JSON.stringify(l)})`),44;let p=0,m;if(this.useJsReadOverlay&&(d||f))m=this.nextHandle++,this.syntheticFileHandles.add(m),this.writeU32(c,m),this.trace(`path_open_overlay(fd=${m}, path=${JSON.stringify(l)})`);else{if(p=this.memfs.exports.path_open(e,t,n,r,i,a,o,s,c),p!==0)return p;m=this.mem.read32(c)}if(d){let e=i&8?null:this.readMemfsFile(l),t=e?Uint8Array.from(e):new Uint8Array;return this.writeFileHandles.set(m,{path:l,contents:t,position:0,size:t.length}),this.readFileHandles.delete(m),this.trace(`path_open_write(fd=${m}, path=${JSON.stringify(l)}, size=${t.length})`),p}if(!this.shouldUseJsReadForPath(l)||!(u&2))return p;let h=f||this.readMemfsFile(l);return h?(this.readFileHandles.set(m,{path:l,contents:h,position:0}),this.trace(`path_open_read(fd=${m}, path=${JSON.stringify(l)}, size=${h.length})`),p):p}path_filestat_get(e,t,n,r,i){this.mem.check();let a=this.mem.readStr(n,r);if(!this.shouldUseJsReadForPath(a))return this.memfs.exports.path_filestat_get(e,t,n,r,i);let o=this.readMemfsFile(a);return o?(this.writeRegularFileStat(i,o.length,a),this.trace(`path_filestat_get(path=${JSON.stringify(a)}, size=${o.length})`),0):this.memfs.exports.path_filestat_get(e,t,n,r,i)}fd_fdstat_get(e,t){let n=this.readFileHandles.get(e)||this.writeFileHandles.get(e);if(!n)return this.memfs.exports.fd_fdstat_get(e,t);let r=this.writeFileHandles.has(e)?6291572:2097190;return this.mem.check(),this.mem.write8(t,4),this.mem.write8(t+1,0),this.mem.write8(t+2,0),this.mem.write8(t+3,0),this.writeU64(t+8,r),this.writeU64(t+16,0),this.trace(`fd_fdstat_get(fd=${e}, path=${JSON.stringify(n.path)})`),0}fd_filestat_get(e,t){let n=this.writeFileHandles.get(e),r=this.readFileHandles.get(e),i=n||r;if(!i)return this.memfs.exports.fd_filestat_get(e,t);let a=n?n.size:r?.contents.length||0;return this.writeRegularFileStat(t,a,i.path),this.trace(`fd_filestat_get(fd=${e}, path=${JSON.stringify(i.path)}, size=${a})`),0}fd_filestat_set_size(e,t){let n=this.writeFileHandles.get(e);if(!n)return this.memfs.exports.fd_filestat_set_size(e,t);let r=this.toNumber(t);return this.ensureWriteCapacity(n,r),r>n.size&&n.contents.fill(0,n.size,r),n.size=r,n.position>r&&(n.position=r),this.trace(`fd_filestat_set_size(fd=${e}, size=${r})`),0}fd_read(e,t,n,r){let i=this.readFileHandles.get(e);if(!i)return this.memfs.exports.fd_read(e,t,n,r);let a=this.copyFileToIovs(i.contents,i.position,t,n,r);return i.position=a.position,this.trace(`fd_read(fd=${e}, bytes=${a.copied})`),0}fd_pread(e,t,n,r,i){let a=this.readFileHandles.get(e);if(!a)return this.memfs.exports.fd_pread(e,t,n,r,i);let o=this.copyFileToIovs(a.contents,this.toNumber(r),t,n,i);return this.trace(`fd_pread(fd=${e}, offset=${this.toNumber(r)}, bytes=${o.copied})`),0}fd_seek(e,t,n,r){let i=this.writeFileHandles.get(e);if(i){let a=this.seekPosition(i.position,i.size,t,n);return a==null?this.memfs.exports.fd_seek(e,t,n,r):(i.position=a,this.mem.check(),this.writeU64(r,i.position),this.trace(`fd_seek_write(fd=${e}, offset=${this.toNumber(t)}, whence=${n})`),0)}let a=this.readFileHandles.get(e);if(!a)return this.memfs.exports.fd_seek(e,t,n,r);let o=this.seekPosition(a.position,a.contents.length,t,n);return o==null?this.memfs.exports.fd_seek(e,t,n,r):(a.position=o,this.mem.check(),this.writeU64(r,a.position),this.trace(`fd_seek(fd=${e}, offset=${this.toNumber(t)}, whence=${n})`),0)}fd_tell(e,t){let n=this.writeFileHandles.get(e)?.position??this.readFileHandles.get(e)?.position;if(n==null){let n=this.memfs.exports.fd_tell;return typeof n==`function`?n(e,t):44}return this.mem.check(),this.writeU64(t,n),this.trace(`fd_tell(fd=${e}, offset=${n})`),0}fd_datasync(e){if(this.writeFileHandles.has(e)||this.readFileHandles.has(e))return 0;let t=this.memfs.exports.fd_datasync;return typeof t==`function`?t(e):0}fd_fdstat_set_flags(e,t){if(this.writeFileHandles.has(e)||this.readFileHandles.has(e))return 0;let n=this.memfs.exports.fd_fdstat_set_flags;return typeof n==`function`?n(e,t):0}path_readlink(e,t,n,r,i,a){return this.mem.check(),this.writeU32(a,0),this.trace(`path_readlink(path=${JSON.stringify(this.mem.readStr(t,n))})`),44}path_unlink_file(e,t,n){this.mem.check();let r=this.mem.readStr(t,n);return this.trace(`path_unlink_file(path=${JSON.stringify(r)})`),0}fd_write(e,t,n,r){let i=this.writeFileHandles.get(e);if(!i)return this.memfs.exports.fd_write(e,t,n,r);this.mem.check();let a=0;for(let e=0;e<n;e+=1){let e=this.mem.read32(t);t+=4;let n=this.mem.read32(t);t+=4,!(n<=0)&&(this.ensureWriteCapacity(i,i.position+n),i.contents.set(new Uint8Array(this.mem.buffer,e,n),i.position),i.position+=n,i.size=Math.max(i.size,i.position),a+=n)}return this.writeU32(r,a),this.trace(`fd_write(fd=${e}, bytes=${a})`),0}fd_close(e){let t=this.syntheticFileHandles.delete(e);if(this.readFileHandles.has(e)){this.readFileHandles.delete(e);let n=t?0:this.memfs.exports.fd_close(e);return this.trace(`fd_close_read(fd=${e}, close=${n})`),n}let n=this.writeFileHandles.get(e);if(n){this.writeFileHandles.delete(e);let r=t?0:this.memfs.exports.fd_close(e),i=n.contents.subarray(0,n.size);this.storeFileContents(n.path,i);let a=this.atomicOutputTarget(n.path);return a&&this.storeFileContents(a,i),this.trace(`fd_close_write(fd=${e}, path=${JSON.stringify(n.path)}, size=${n.size}, close=${r}, target=${JSON.stringify(a)})`),0}return t?0:this.memfs.exports.fd_close(e)}debugEvaluate(e){let t=this.debugSession;if(!t)throw Error(`unavailable`);let n=[...t.frames].reverse().find(e=>e.functionId===t.currentFunctionId),r=t.currentLine,i=[...t.variableMetadata[t.currentFunctionId]||[]].reverse().filter(e=>r>=e.fromLine&&r<=e.toLine),a=[...t.globalVariableMetadata||[]].reverse().filter(e=>r>=e.fromLine&&r<=e.toLine);return Le(e,e=>{let r=(e,t)=>{let n=e.dimensions?.length?e.dimensions:e.length?[e.length]:[],r=Number(t);if(!Number.isFinite(r)||r<=0||!n.length||!e.elementKind&&!e.structFields?.length)throw Error(`unavailable`);this.mem?.check?.();let i=e.structFields?.length&&e.structSize?e.structSize:e.elementKind===`double`?8:e.elementKind===`bool`||e.elementKind===`char`?1:4,a=(e,t)=>{if(e===`bool`)return!!this.mem.read8(t);if(e===`char`){let e=this.mem.read8(t);return e>=32&&e<=126?String.fromCharCode(e):e}return e===`float`?this.mem.readFloat32(t):e===`double`?this.mem.readFloat64(t):this.mem.readInt32(t)},o=t=>({__debugExpressionKind:`object`,has:t=>!!e.structFields?.some(e=>e.name===t),get:n=>{let r=e.structFields?.find(e=>e.name===n);if(!r)throw Error(`unavailable`);return a(r.kind,t+r.offset)},keys:()=>e.structFields?.map(e=>e.name)||[]}),s=(t,n)=>({__debugExpressionKind:`array`,length:n[0],truncated:n[0]>8,get:r=>{if(!Number.isInteger(r)||r<0||r>=n[0])throw Error(`unavailable`);if(n.length>1)return s(t+r*(n.slice(1).reduce((e,t)=>e*t,1)*i),n.slice(1));if(e.structFields?.length&&e.structSize)return o(t+r*e.structSize);if(!e.elementKind)throw Error(`unavailable`);return a(e.elementKind,t+r*i)},keys:()=>Array.from({length:Math.min(n[0],8)},(e,t)=>t)});return s(r,n)},o=(e,t)=>{if(t==null||t===`?`)throw Error(`unavailable`);return e.kind===`array`?r(e,t):Pe(t)},s=i.find(t=>t.name===e);if(s)return o(s,n?.values.get(s.slot));let c=a.find(t=>t.name===e);if(c)return o(c,t.globalValues.get(c.slot));throw Error(`unavailable`)})}pauseDebugSession(e,t,n,r){let i=e.buffer;if(!i)return 0;e.currentFunctionId=t,e.currentLine=n;let a=[...e.frames].reverse().find(e=>e.functionId===t);a&&(a.line=n),e.pauseOnEntry=!1,e.stepArmed=!1,e.nextLineArmed=!1,e.nextLineDepth=0,e.stepOutArmed=!1,this.trace(`pause(function=${t}, line=${n}, reason=${r})`);let o=e.variableMetadata[t]?.flatMap(e=>{if(n<e.fromLine||n>e.toLine)return[];if(e.kind===`array`){this.mem?.check?.();let t=Number(a?.values.get(e.slot)??NaN),n=e.dimensions?.length?e.dimensions:e.length?[e.length]:[];if(!Number.isFinite(t)||t<=0||!n.length||!e.elementKind&&!e.structFields?.length)return[{name:e.name,value:`?`}];if(e.structFields?.length&&e.structSize){let r=Math.min(n[0],8),i=[];for(let n=0;n<r;n+=1){let r=[];for(let i of e.structFields){let a=t+n*e.structSize+i.offset;if(i.kind===`bool`){r.push(`${i.name}: ${this.mem.read8(a)?`true`:`false`}`);continue}if(i.kind===`char`){let e=this.mem.read8(a);r.push(`${i.name}: ${e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`}`);continue}if(i.kind===`float`){r.push(`${i.name}: ${this.mem.readFloat32(a)}`);continue}if(i.kind===`double`){r.push(`${i.name}: ${this.mem.readFloat64(a)}`);continue}r.push(`${i.name}: ${this.mem.readInt32(a)}`)}i.push(`{${r.join(`, `)}}`)}return[{name:e.name,value:`[${i.join(`, `)}${n[0]>r?`, ...`:``}]`}]}if(!e.elementKind)return[{name:e.name,value:`?`}];let r=e.elementKind===`double`?8:e.elementKind===`bool`||e.elementKind===`char`?1:4;if(n.length===2){let i=Math.min(n[0],4),a=Math.min(n[1],8),o=[];for(let s=0;s<i;s+=1){let i=[];for(let o=0;o<a;o+=1){let a=t+(s*n[1]+o)*r;if(e.elementKind===`bool`){i.push(this.mem.read8(a)?`true`:`false`);continue}if(e.elementKind===`char`){let e=this.mem.read8(a);i.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(e.elementKind===`float`){i.push(`${this.mem.readFloat32(a)}`);continue}if(e.elementKind===`double`){i.push(`${this.mem.readFloat64(a)}`);continue}i.push(`${this.mem.readInt32(a)}`)}o.push(`[${i.join(`, `)}${n[1]>a?`, ...`:``}]`)}return[{name:e.name,value:`[${o.join(`, `)}${n[0]>i?`, ...`:``}]`}]}let i=Math.min(n[0],8),o=[];for(let n=0;n<i;n+=1){let i=t+n*r;if(e.elementKind===`bool`){o.push(this.mem.read8(i)?`true`:`false`);continue}if(e.elementKind===`char`){let e=this.mem.read8(i);o.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(e.elementKind===`float`){o.push(`${this.mem.readFloat32(i)}`);continue}if(e.elementKind===`double`){o.push(`${this.mem.readFloat64(i)}`);continue}o.push(`${this.mem.readInt32(i)}`)}return[{name:e.name,value:`[${o.join(`, `)}${n[0]>i?`, ...`:``}]`}]}let t=a?.values.get(e.slot)??`?`;return[{name:e.name,value:t}]})||[],s=new Set(o.map(e=>e.name)),c=(e.globalVariableMetadata||[]).flatMap(t=>{if(s.has(t.name)||n<t.fromLine||n>t.toLine)return[];if(t.kind===`array`){this.mem?.check?.();let n=Number(e.globalValues?.get(t.slot)??NaN),r=t.dimensions?.length?t.dimensions:t.length?[t.length]:[];if(!Number.isFinite(n)||n<=0||!r.length||!t.elementKind&&!t.structFields?.length)return[{name:t.name,value:`?`}];if(t.structFields?.length&&t.structSize){let e=Math.min(r[0],8),i=[];for(let r=0;r<e;r+=1){let e=[];for(let i of t.structFields){let a=n+r*t.structSize+i.offset;if(i.kind===`bool`){e.push(`${i.name}: ${this.mem.read8(a)?`true`:`false`}`);continue}if(i.kind===`char`){let t=this.mem.read8(a);e.push(`${i.name}: ${t>=32&&t<=126?`'${String.fromCharCode(t)}'`:`${t}`}`);continue}if(i.kind===`float`){e.push(`${i.name}: ${this.mem.readFloat32(a)}`);continue}if(i.kind===`double`){e.push(`${i.name}: ${this.mem.readFloat64(a)}`);continue}e.push(`${i.name}: ${this.mem.readInt32(a)}`)}i.push(`{${e.join(`, `)}}`)}return[{name:t.name,value:`[${i.join(`, `)}${r[0]>e?`, ...`:``}]`}]}if(!t.elementKind)return[{name:t.name,value:`?`}];let i=t.elementKind===`double`?8:t.elementKind===`bool`||t.elementKind===`char`?1:4;if(r.length===2){let e=Math.min(r[0],4),a=Math.min(r[1],8),o=[];for(let s=0;s<e;s+=1){let e=[];for(let o=0;o<a;o+=1){let a=n+(s*r[1]+o)*i;if(t.elementKind===`bool`){e.push(this.mem.read8(a)?`true`:`false`);continue}if(t.elementKind===`char`){let t=this.mem.read8(a);e.push(t>=32&&t<=126?`'${String.fromCharCode(t)}'`:`${t}`);continue}if(t.elementKind===`float`){e.push(`${this.mem.readFloat32(a)}`);continue}if(t.elementKind===`double`){e.push(`${this.mem.readFloat64(a)}`);continue}e.push(`${this.mem.readInt32(a)}`)}o.push(`[${e.join(`, `)}${r[1]>a?`, ...`:``}]`)}return[{name:t.name,value:`[${o.join(`, `)}${r[0]>e?`, ...`:``}]`}]}let a=Math.min(r[0],8),o=[];for(let e=0;e<a;e+=1){let r=n+e*i;if(t.elementKind===`bool`){o.push(this.mem.read8(r)?`true`:`false`);continue}if(t.elementKind===`char`){let e=this.mem.read8(r);o.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(t.elementKind===`float`){o.push(`${this.mem.readFloat32(r)}`);continue}if(t.elementKind===`double`){o.push(`${this.mem.readFloat64(r)}`);continue}o.push(`${this.mem.readInt32(r)}`)}return[{name:t.name,value:`[${o.join(`, `)}${r[0]>a?`, ...`:``}]`}]}let r=e.globalValues?.get(t.slot)??`?`;return[{name:t.name,value:r}]})||[],l=new Map(o.map(e=>[e.name,e])),u=new Map(c.map(e=>[e.name,e]));for(let e of l.keys())u.delete(e);e.onPause?.({type:`pause`,line:n,reason:r,locals:[...l.values(),...u.values()],callStack:[...e.frames].reverse().map(e=>({functionName:e.functionName,line:e.line}))});let d=Atomics.load(i,0);for(;;){if(e.interruptBuffer?.[0]===2||(Atomics.wait(i,0,d,100),e.interruptBuffer?.[0]===2))throw new Oe;let t=Atomics.exchange(i,1,0);if(t===1)return e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===2)return e.stepArmed=!0,e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===3)return e.nextLineArmed=!0,e.nextLineFunctionId=e.currentFunctionId,e.nextLineLine=e.currentLine,e.nextLineDepth=e.callDepth,e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===4)return e.stepOutArmed=!0,e.stepOutDepth=Math.max(0,e.callDepth-1),e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===5){let t=e.watchBuffer?We(e.watchBuffer):``,n=`?`;try{n=t?this.debugEvaluate(t):`?`}catch(e){n=e instanceof Error&&e.message===`unavailable`?`?`:`error`}e.watchResultBuffer&&Ue([n],e.watchResultBuffer)}}}__wasm_idle_debug_enter(e,t){let n=this.debugSession;return n?.buffer?(n.callDepth+=1,n.currentFunctionId=e,n.currentLine=t,n.frames.push({functionId:e,functionName:n.functionMetadata[e]||`fn_${e}`,line:t,values:new Map}),this.trace(`enter(function=${e}, line=${t}, depth=${n.callDepth})`),n.pauseOnEntry?this.pauseDebugSession(n,e,t,`entry`):n.stepArmed?this.pauseDebugSession(n,e,t,`step`):0):0}__wasm_idle_debug_leave(e){let t=this.debugSession;if(!t?.buffer)return 0;this.trace(`leave(function=${e}, depth=${t.callDepth})`),t.nextLineArmed&&e===t.nextLineFunctionId&&t.callDepth<=(t.nextLineDepth??t.callDepth)&&(t.nextLineArmed=!1,t.nextLineDepth=0,t.stepArmed=!0),t.callDepth=Math.max(0,t.callDepth-1),t.currentFunctionId===e&&(t.currentFunctionId=0);for(let n=t.frames.length-1;n>=0;--n)if(t.frames[n]?.functionId===e){t.frames.splice(n,1);break}return 0}__wasm_idle_debug_value_num(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,Number.isInteger(n)?String(n):`${n}`),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,Number.isInteger(n)?String(n):`${n}`);break}}return 0}__wasm_idle_debug_value_bool(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,n?`true`:`false`),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,n?`true`:`false`);break}}return 0}__wasm_idle_debug_value_addr(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,String(n>>>0)),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,String(n>>>0));break}}return 0}__wasm_idle_debug_value_text(e,t,n,r){let i=this.debugSession;if(!i?.buffer)return 0;this.mem?.check?.();let a=this.mem?.readStr?this.mem.readStr(n,r):`?`;if(e===0)return i.globalValues.set(t,a),0;for(let n=i.frames.length-1;n>=0;--n){let r=i.frames[n];if(r?.functionId===e){r.values.set(t,a);break}}return 0}__wasm_idle_debug_line(e,t){let n=this.debugSession;if(!n?.buffer)return 0;let r=Atomics.load(n.buffer,2);if(r!==n.breakpointVersion){let e=Math.max(0,Atomics.load(n.buffer,3)),t=new Set;for(let r=0;r<e&&r+4<n.buffer.length;r+=1){let e=Atomics.load(n.buffer,r+4);e>0&&t.add(e)}n.breakpoints=t,n.breakpointVersion=r}if(n.resumeSkipActive){if(e===n.resumeSkipFunctionId&&t===n.resumeSkipLine)return 0;n.resumeSkipActive=!1,n.resumeSkipFunctionId=0,n.resumeSkipLine=0}let i=``;return n.pauseOnEntry?i=`entry`:n.breakpoints.has(t)?i=`breakpoint`:n.stepArmed?i=`step`:n.nextLineArmed&&n.callDepth<=(n.nextLineDepth??n.callDepth)&&e===n.nextLineFunctionId&&t!==n.nextLineLine?i=`nextLine`:n.stepOutArmed&&n.callDepth<=n.stepOutDepth&&(i=`stepOut`),i?this.pauseDebugSession(n,e,t,i):0}environ_sizes_get(e,t){this.mem.check();let n=0,r=Object.getOwnPropertyNames(this.environ);for(let e of r){let t=this.environ[e];n+=e.length+t.length+2}return this.mem.write32(e,r.length),this.mem.write32(t,n),this.trace(`environ_sizes_get(count=${r.length}, bytes=${n})`),0}environ_get(e,t){this.mem.check();let n=Object.getOwnPropertyNames(this.environ);this.trace(`environ_get(entries=${JSON.stringify(n)})`);for(let r of n)this.mem.write32(e,t),e+=4,t+=this.mem.writeStr(t,`${r}=${this.environ[r]}`);return 0}args_sizes_get(e,t){this.mem.check();let n=0;for(let e of this.argv)n+=e.length+1;return this.mem.write32(e,this.argv.length),this.mem.write32(t,n),this.trace(`args_sizes_get(count=${this.argv.length}, bytes=${n})`),0}args_get(e,t){this.mem.check(),this.trace(`args_get(argv=${JSON.stringify(this.argv)})`);for(let n of this.argv)this.mem.write32(e,t),e+=4,t+=this.mem.writeStr(t,n);return 0}random_get(e,t){let n=new Uint8Array(this.mem.buffer,e,t);for(let e=0;e<t;++e)n[e]=Math.random()*256|0}clock_time_get(e,t,n){this.mem.check();let r=e===1&&typeof performance<`u`?performance.now():Date.now(),i=BigInt(Math.floor(r*1e6));return this.mem.view.setBigUint64(n,i,!0),this.trace(`clock_time_get(clock=${e}, ns=${i})`),0}poll_oneoff(){throw new De(`wasi_unstable`,`poll_oneoff`)}fd_filestat_set_times(){return this.trace(`fd_filestat_set_times()`),0}path_filestat_set_times(){return this.trace(`path_filestat_set_times()`),0}sock_accept(){return this.trace(`sock_accept() unsupported`),58}sock_recv(){return this.trace(`sock_recv() unsupported`),58}sock_send(){return this.trace(`sock_send() unsupported`),58}sock_shutdown(){return this.trace(`sock_shutdown() unsupported`),58}path_link(e,t,n,r,i,a,o){this.mem.check();let s=this.mem.readStr(n,r).replace(/^\/+/,``),c=this.mem.readStr(a,o).replace(/^\/+/,``);return this.trace(`path_link(source=${JSON.stringify(s)}, target=${JSON.stringify(c)})`),this.storeFileContents(c,new Uint8Array(this.memfs.getFileContents(s))),0}path_rename(e,t,n,r,i,a){this.mem.check();let o=this.mem.readStr(t,n).replace(/^\/+/,``),s=this.mem.readStr(i,a).replace(/^\/+/,``);return this.trace(`path_rename(source=${JSON.stringify(o)}, target=${JSON.stringify(s)})`),this.storeFileContents(s,new Uint8Array(this.memfs.getFileContents(o))),0}};const Ke=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP
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
`,qe=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP
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
`,Je=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP
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
`,Ye=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP
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
`,Xe=String.raw`#ifndef WASM_CLANG_EXT_ROPE
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
`,Ze=String.raw`#ifndef WASM_CLANG_SETJMP_H
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
`,Qe=String.raw`#ifndef WASM_CLANG_BITS_STDCPP_H
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
`,$e=String.raw`#ifndef WASM_CLANG_BITS_EXTCXX_H
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
`,et=[{path:`include/setjmp.h`,contents:Ze},{path:`include/bits/stdc++.h`,contents:Qe},{path:`include/bits/extc++.h`,contents:$e},{path:`include/c++/v1/ext/rope`,contents:Xe},{path:`include/c++/v1/ext/pb_ds/tree_policy.hpp`,contents:Ke},{path:`include/c++/v1/ext/pb_ds/assoc_container.hpp`,contents:qe},{path:`include/c++/v1/ext/pb_ds/hash_policy.hpp`,contents:Je},{path:`include/c++/v1/ext/pb_ds/priority_queue.hpp`,contents:Ye}];function tt(e){e.addDirectory(`include/c++/v1/ext/pb_ds`),e.addDirectory(`include/bits`);for(let t of et)e.addFile(t.path,t.contents)}const W=e=>JSON.stringify(e.length>96?e.slice(0,93)+`...`:e);var nt=class{ready;mem=null;hostMem_=null;stdinStr;stdin;stdout;trace;instance=null;exports;out=!0;filePaths=new Set;fileOverlays=new Map;constructor(e){this.stdin=e.stdin,this.stdout=e.stdout,this.stdinStr=e.stdinStr||``,this.trace=e.trace||(()=>{});let t=F(this,`abort`,`host_write`,`host_read`,`memfs_log`,`copy_in`,`copy_out`);this.ready=we(e.moduleUrl,e.progress).then(e=>WebAssembly.instantiate(e,{env:t})).then(e=>{this.instance=e,this.exports=e.exports,this.mem=new ge(this.exports.memory),this.exports.init()})}set hostMem(e){this.hostMem_=e}setStdinStr(e){this.stdinStr=e}addDirectory(e){this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e),this.exports.AddDirectoryNode(e.length)}addFile(e,t){let n=t instanceof ArrayBuffer?t.byteLength:t.length;this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e);let r=this.exports.AddFileNode(e.length,n),i=this.exports.GetFileNodeAddress(r);this.mem.check(),this.mem.write(i,t),this.filePaths.add(this.normalizePath(e))}setFile(e,t){let n=this.normalizePath(e);this.filePaths.add(n),this.fileOverlays.set(n,Uint8Array.from(t))}hasFile(e){return this.filePaths.has(this.normalizePath(e))}normalizePath(e){return e.replaceAll(`\\`,`/`).replace(/^\.\//,``).replace(/^\/+/,``)}getFileContents(e){let t=this.fileOverlays.get(this.normalizePath(e));if(t)return t;this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e);let n=this.exports.FindNode(e.length),r=this.exports.GetFileNodeAddress(n),i=this.exports.GetFileNodeSize(n);return new Uint8Array(this.mem.buffer,r,i)}abort(){throw this.trace(`abort()`),new Oe}host_write(e,t,n,r){this.hostMem_.check(),Ae(e<=2);let i=0,a=``;for(let e=0;e<n;++e){let e=this.hostMem_.read32(t);t+=4;let n=this.hostMem_.read32(t);t+=4,a+=this.hostMem_.readStrR(e,n),i+=n}return this.hostMem_.write32(r,i),this.trace(`host_write(fd=${e}, bytes=${i}, data=${W(a)})`),this.out&&this.stdout(a),0}host_read(e,t,n,r){this.hostMem_.check(),Ae(e===0);let i=0;for(let r=0;r<n;++r){let n=this.hostMem_.read32(t);t+=4;let r=this.hostMem_.read32(t);t+=4,this.stdinStr.length||(this.stdinStr=this.stdin());let a=Math.min(r,this.stdinStr.length);if(a===0)break;let o=this.stdinStr.substring(0,a);if(this.hostMem_.write(n,this.stdinStr.substring(0,a)),this.stdinStr=this.stdinStr.substring(a),i+=a,this.trace(`host_read(fd=${e}, bytes=${a}, data=${W(o)})`),a!==r)break}return this.hostMem_.write32(r,i),i===0&&this.trace(`host_read(fd=${e}, bytes=0)`),0}memfs_log(e,t){this.mem.check();let n=this.mem.readStr(e,t);this.trace(`memfs_log(${W(n)})`)}copy_out(e,t,n){this.hostMem_.check();let r=new Uint8Array(this.hostMem_.buffer,e,n);this.mem.check();let i=new Uint8Array(this.mem.buffer,t,n);r.set(i)}copy_in(e,t,n){this.mem.check();let r=new Uint8Array(this.mem.buffer,e,n);this.hostMem_.check();let i=new Uint8Array(this.hostMem_.buffer,t,n);r.set(i)}};function*rt(e){let t=e instanceof Uint8Array?e:new Uint8Array(e),n=0,r=``,i=e=>(n+=e,I(t,n-e,e)),a=e=>(n+=e,he(t,n-e,e)),o=()=>n=n+511&-512;for(;n+512<=t.length;){let e={filename:i(100),mode:a(8),owner:a(8),group:a(8),size:a(12),mtime:a(12),checksum:a(8),type:i(1),linkname:i(100),ustar:i(8)};if(!e.ustar)return;let s={...e,ownerName:i(32),groupName:i(32),devMajor:i(8),devMinor:i(8),filenamePrefix:i(155)};if(o(),(s.size>0||s.type===`0`||s.type===``||s.type===`L`)&&(s.contents=t.subarray(n,n+s.size),n+=s.size,o()),s.type===`L`){s.contents&&(r=I(s.contents,0,s.size));continue}s.filename=r||(s.filenamePrefix?`${s.filenamePrefix}/${s.filename}`:s.filename),r=``,yield s}}function it(e,t){for(let n of rt(e))switch(n.type){case``:case`0`:t.addFile(n.filename,n.contents);break;case`5`:t.addDirectory(n.filename);break;default:throw Error(`unsupported tar entry type: ${n.type}`)}}const at=`\x1B[92m`,G=`\x1B[0m`,ot=e=>Math.max(0,Math.min(1,Number.isFinite(e)?e:0));function st(e){let t={clang:0,lld:0,memfs:0},n=()=>{e((t.clang+t.lld+t.memfs)/3)},r=e=>({set(r){t[e]=ot(r),n()}});return{clang:r(`clang`),lld:r(`lld`),memfs:r(`memfs`)}}const ct=(e,t)=>{let n=e?.toString().trim();if(!n)throw Error(`${t} is required`);let r;try{r=new URL(n,typeof location<`u`?location.href:void 0)}catch{throw Error(`${t} must be an absolute HTTP(S) URL`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`${t} must use HTTP(S)`);return r},lt=e=>{let t=ct(e,`wasm-clang runtime base URL`);return t.pathname.endsWith(`/`)||(t.pathname+=`/`),t.hash=``,t},K=(e,t)=>new URL(t,lt(e)).toString(),ut=(e,t)=>K(e,t),dt=e=>lt(e).toString(),ft=e=>ut(e,`runtime-manifest.v1.json`);function pt(e,t){let n=dt(e);return{manifest:ft(n).toString(),memfs:K(n,t?.compiler.memfs.asset||`bin/memfs.wasm.gz`).toString(),clang:K(n,t?.compiler.clang.asset||`bin/clang.wasm.gz`).toString(),lld:K(n,t?.compiler.lld.asset||`bin/lld.wasm.gz`).toString(),sysroot:K(n,t?.compiler.sysroot.asset||`bin/sysroot.tar.gz`).toString(),clangdJs:K(n,t?.clangd.js||`clangd/clangd.js`).toString(),clangdWasm:K(n,t?.clangd.wasm||`clangd/clangd.wasm.gz`).toString()}}globalThis.document===void 0&&(globalThis.document={querySelectorAll:(()=>[])});const mt=`-std=gnu++2a`;function ht(e){return(e||``).trim().toUpperCase().replaceAll(/\s+/g,``)}function gt(e){switch(ht(e)){case`03`:case`CPP03`:case`C++03`:case`GNU++03`:case`GNUC++03`:return`-std=gnu++03`;case`11`:case`CPP11`:case`C++11`:case`GNU++11`:case`GNUC++11`:return`-std=gnu++11`;case`14`:case`CPP14`:case`C++14`:case`GNU++14`:case`GNUC++14`:return`-std=gnu++14`;case`17`:case`CPP17`:case`C++17`:case`GNU++17`:case`GNUC++17`:return`-std=gnu++17`;case`20`:case`23`:case`26`:case`CPP20`:case`CPP23`:case`CPP26`:case`C++20`:case`C++23`:case`C++26`:case`GNU++20`:case`GNU++23`:case`GNU++26`:case`GNUC++20`:case`GNUC++23`:case`GNUC++26`:return mt;default:return mt}}function _t(e){switch(ht(e)){case`99`:case`C99`:case`GNU99`:case`GNUC99`:return`-std=gnu99`;case`11`:case`C11`:case`GNU11`:case`GNUC11`:return`-std=gnu11`;case`17`:case`18`:case`C17`:case`C18`:case`GNU17`:case`GNU18`:case`GNUC17`:case`GNUC18`:return`-std=gnu17`;default:return`-std=gnu11`}}function vt(e,t){return e===`C`?{languageArg:`c`,standardArg:_t(t.cVersion)}:e===`OBJC`?{languageArg:`objective-c`,standardArg:_t(t.cVersion)}:{languageArg:`c++`,standardArg:gt(t.cppVersion)}}const q=e=>e.replaceAll(`\\`,`/`).split(`/`).filter(e=>e&&e!==`.`&&e!==`..`).join(`/`);function yt(e,t){let n=q(t||``),r=`main`,i=n&&/\.[A-Za-z0-9_-]+$/.test(n)?n:`${n||r}.${e===`C`?`c`:e===`OBJC`?`m`:`cc`}`,a=(i.split(`/`).pop()||i).replace(/\.[^.]+$/,``)||r;return{input:i,obj:`${a}.o`,wasm:`${a}.wasm`}}const bt=e=>{let t=encodeURIComponent(e),n=``;for(let e=0;e<t.length;){let r=t[e];if(e+=1,r==`%`){let r=t.substring(e,e+=2);r&&(n+=String.fromCharCode(parseInt(r,16)))}else n+=r}return n};function xt(e,t){let n=[...e],r=t,i,a=!1;for(let t=0;t<e.length;t+=1){let o=e[t],s=e[t+1];if(r){n[t]=` `,o===`*`&&s===`/`&&(n[t+1]=` `,t+=1,r=!1);continue}if(i){n[t]=` `,a?a=!1:o===`\\`?a=!0:o===i&&(i=void 0);continue}if(o===`/`&&s===`*`){n[t]=` `,n[t+1]=` `,t+=1,r=!0;continue}if(o===`/`&&s===`/`){for(let r=t;r<e.length;r+=1)n[r]=` `;break}(o===`"`||o===`'`)&&(n[t]=` `,i=o)}return{line:n.join(``),inBlockComment:r}}var St=class{ready;memfs;stdout;moduleCache;showTiming;log;debug=!1;debugBreakpoints=new Set;debugPauseOnEntry=!1;debugBuffer;debugInterruptBuffer;debugWatchBuffer;debugWatchResultBuffer;onDebugEvent;debugVariableMetadata={};debugGlobalMetadata=[];debugFunctionMetadata={};lastBuildKey=``;path;assetUrls;compilerConfig;wasm;lastArtifactPath=`main.wasm`;traceStartedAt=0;progress;constructor(e){this.moduleCache={},this.stdout=e.stdout||(()=>{}),this.showTiming=e.showTiming||!1,this.log=e.log||!1,this.path=e.runtimeBaseUrl.toString(),this.assetUrls=pt(this.path,e.manifest),this.compilerConfig=e.manifest?.compiler,this.onDebugEvent=e.onDebugEvent,this.progress=st(t=>e.progress?.(t)),this.memfs=new nt({stdout:this.stdout,stdin:e.stdin||(()=>``),moduleUrl:this.assetUrls.memfs,progress:this.progress.memfs,trace:e=>this.trace(e)});let t=this.getModule(this.assetUrls.clang,this.progress.clang),n=this.getModule(this.assetUrls.lld,this.progress.lld),r=this.memfs.ready.then(async()=>{await this.hostLogAsync(`Untarring ${this.assetUrls.sysroot}`,Ce(this.assetUrls.sysroot).then(e=>it(e,this.memfs))),tt(this.memfs)});this.ready=Promise.all([t,n,r]).then(()=>void 0)}hostLog(e){if(!this.log)return;let t=`[1;93m>${G} `;this.stdout(`${t}${e}`)}beginTrace(e){this.debug=e,this.traceStartedAt=Date.now()}trace(e){if(!this.debug||!this.log)return;let t=Date.now()-this.traceStartedAt;this.stdout(`\x1b[2m[debug +${t}ms] ${e}\x1b[0m\n`)}async hostLogAsync(e,t){let n=+new Date;this.hostLog(`${e}...`);let r=await t,i=+new Date;return this.log&&this.stdout(` done.`),this.showTiming&&this.stdout(` ${at}(${i-n}ms)${G}\n`),this.log&&this.stdout(`
`),r}async getModule(e,t){if(this.moduleCache[e])return this.moduleCache[e];let n=await this.hostLogAsync(`Fetching and compiling ${e}`,we(e,t));return this.moduleCache[e]=n,n}addWorkspaceDirectories(e,t=new Set){let n=q(e).split(`/`).slice(0,-1),r=``;for(let e of n)r=r?`${r}/${e}`:e,t.has(r)||(this.memfs.addDirectory(r),t.add(r))}addWorkspaceFiles(e=[],t=``){let n=new Set,r=q(t);for(let t of e){let e=q(t.path);!e||e===r||(this.addWorkspaceDirectories(e,n),this.memfs.addFile(e,bt(t.content)))}}async compile(e){let t=q(e.input||`main.cc`)||`main.cc`,n=e.code,r=e.obj,i=e.language===`C`?`C`:e.language===`OBJC`?`OBJC`:`CPP`,a=e.compileArgs??e.args??[],{languageArg:o,standardArg:s}=vt(i,e),c=!!e.debug,l=c?`0`:e.opt||`2`;if(c){let e=n.split(`
`),t=!1,r=e.map(e=>{let n=xt(e,t);return t=n.inBlockComment,n.line}),a=e=>{if(/^(?:do|else)$/.test(e))return!0;if(!/^(?:else\s+)?(?:if|for|while)\s*\(/.test(e))return!1;let t=e.indexOf(`(`),n=0;for(let r=t;r<e.length;r+=1)if(e[r]===`(`&&(n+=1),e[r]===`)`&&(--n,n===0))return e.slice(r+1).trim()===``;return!1},o=new Set,s=!1,c=!1;for(let e=0;e<r.length;e+=1){let t=r[e].trim();if(!t)continue;let n=c,i=n;n&&t.includes(`;`)&&(c=!1),s&&(s=!1,t!==`{`&&(i=!0,!t.includes(`;`)&&!t.includes(`{`)&&!a(t)&&(c=!0))),/^while\s*\(.*\)\s*;$/.test(t)&&(i=!0),i&&o.add(e),a(t)&&(s=!0)}let l=0,u=0,d=0,f=1,p=1,m=new Map,h=new Map,g=new Map,_,v=new Map,y=``,b=[],x=!1;for(let t of e){let e=t;if(x){let t=e.indexOf(`*/`);if(t===-1)continue;e=e.slice(t+2),x=!1}let n=e.indexOf(`/*`);if(n!==-1){let t=e.indexOf(`*/`,n+2);t===-1?(x=!0,e=e.slice(0,n)):e=e.slice(0,n)+e.slice(t+2)}let r=e.indexOf(`//`);r!==-1&&(e=e.slice(0,r));let i=e.trim();if(!y){let e=i.match(/^struct\s+([A-Za-z_]\w*)\s*\{$/);e?.[1]&&(y=e[1],b=[]);continue}if(i===`};`){let e=0,t=1,n=[];for(let r of b){let i=r.kind===`double`?8:r.kind===`bool`||r.kind===`char`?1:4;e%i!==0&&(e+=i-e%i),n.push({name:r.name,kind:r.kind,offset:e}),e+=i,t=Math.max(t,i)}e%t!==0&&(e+=t-e%t),v.set(y,{fields:n,size:Math.max(e,1)}),y=``,b=[];continue}let a=i.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/);if(a)for(let e of a[2].split(`,`)){let t=e.split(`=`)[0]?.trim()||``;if(!t||/[*&\[]/.test(t))continue;let n=t.match(/([A-Za-z_]\w*)\s*$/)?.[1];n&&b.push({name:n,kind:a[1]})}}this.debugVariableMetadata={},this.debugGlobalMetadata=[],this.debugFunctionMetadata={};let S=[],C=i===`CPP`?`extern "C" `:``,w=[`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_enter"))) void __wasm_idle_debug_enter(int functionId, int line);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_leave"))) void __wasm_idle_debug_leave(int functionId);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_num"))) void __wasm_idle_debug_value_num(int functionId, int slot, double value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_bool"))) void __wasm_idle_debug_value_bool(int functionId, int slot, int value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_addr"))) void __wasm_idle_debug_value_addr(int functionId, int slot, int value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_text"))) void __wasm_idle_debug_value_text(int functionId, int slot, const char* ptr, int len);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_line"))) void __wasm_idle_debug_line(int functionId, int line);`],T=i===`CPP`?[`#include <cstdio>`,`#include <iostream>`,`#include <map>`,`#include <set>`,`#include <string>`,`#include <type_traits>`,`#include <vector>`,...w,`template <typename T>`,`static inline std::string __wasm_idle_debug_format_value(const T& value) {`,`    if constexpr (std::is_same_v<T, bool>) return value ? "true" : "false";`,`    else if constexpr (std::is_same_v<T, char>) return std::string("'") + value + "'";`,`    else if constexpr (std::is_same_v<T, signed char> || std::is_same_v<T, unsigned char>) return std::to_string((int)value);`,`    else if constexpr (std::is_integral_v<T> || std::is_floating_point_v<T>) return std::to_string(value);`,`    else return "?";`,`}`,`template <typename T>`,`static inline void __wasm_idle_debug_emit_vector(int functionId, int slot, const std::vector<T>& values) {`,`    std::string text = "[";`,`    int count = 0;`,`    for (const auto& value : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(value);`,`        count += 1;`,`    }`,`    text += "]";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`,`template <typename T>`,`static inline void __wasm_idle_debug_emit_set(int functionId, int slot, const std::set<T>& values) {`,`    std::string text = "{";`,`    int count = 0;`,`    for (const auto& value : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(value);`,`        count += 1;`,`    }`,`    text += "}";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`,`template <typename K, typename V>`,`static inline void __wasm_idle_debug_emit_map(int functionId, int slot, const std::map<K, V>& values) {`,`    std::string text = "{";`,`    int count = 0;`,`    for (const auto& entry : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(entry.first);`,`        text += ": ";`,`        text += __wasm_idle_debug_format_value(entry.second);`,`        count += 1;`,`    }`,`    text += "}";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`]:[`#include <stdio.h>`,...w];for(let t=0;t<e.length;t+=1){let n=e[t],a=n.match(/^\s*/)?.[0]||``,s=n,c=r[t],y=c.trim(),b=o.has(t),x=u>0&&l>=u,C=u===0&&l===0&&!y.includes(`(`)&&!y.startsWith(`#`),w=/^(while|if|for)\s*\(/.test(y)&&!y.includes(`{`),E=[],D=[],O=new Set,k=C&&y.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/);if(k){let e=k[1]===`bool`?`bool`:`number`,n=[],r=``,i=0;for(let e of k[2]){if(e===`,`&&i===0){r.trim()&&n.push(r.trim()),r=``;continue}e===`{`&&(i+=1),e===`}`&&(i=Math.max(0,i-1)),r+=e}r.trim()&&n.push(r.trim());for(let r of n){let[n]=r.split(`=`),i=n?.trim()||``;if(/[*&\[]/.test(i))continue;let a=i.match(/([A-Za-z_]\w*)\s*$/)?.[1];if(!a)continue;let o=p++;h.set(a,{slot:o,kind:e,fromLine:t+1,toLine:2**53-1}),this.debugGlobalMetadata=[...this.debugGlobalMetadata,{slot:o,name:a,kind:e,fromLine:t+1,toLine:2**53-1}],S.push(`${e===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${o}, ${a});`)}}let A=C&&y.match(/^(?:const\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\[(\d+)\]\s*(?:=.*)?;$/);if(A){let e=v.get(A[1]);if(e){let n=p++;this.debugGlobalMetadata=[...this.debugGlobalMetadata,{slot:n,name:A[2],kind:`array`,length:Number(A[3]),dimensions:[Number(A[3])],structFields:e.fields,structSize:e.size,fromLine:t+1,toLine:2**53-1}],S.push(`__wasm_idle_debug_value_addr(0, ${n}, (int)((unsigned long long)(${A[2]})));`)}}if(x&&!b&&y&&!y.startsWith(`#`)&&y!==`{`&&y!==`}`&&!y.startsWith(`else`)&&!y.startsWith(`case `)&&y!==`case`&&!y.startsWith(`default`)&&!y.startsWith(`catch`)&&!/^(public|private|protected)\s*:/.test(y)&&!y.endsWith(`:`)&&!y.includes(` else `)){E.push(`${a}__wasm_idle_debug_line(${d}, ${t+1});`);let e=y.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/),n=y.match(/^(?:const\s+)?(?:(?:std::)?(vector|set|map))\s*<(.+)>\s+([A-Za-z_]\w*)\s*(?:=.*)?;$/);if(n&&d){let e=p++,r=n[1],i=n[3];O.add(i),g.set(i,{slot:e,container:r,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:i,kind:`text`,fromLine:t+1,toLine:2**53-1}],D.push(`${a}__wasm_idle_debug_emit_${r}(${d}, ${e}, ${i});`)}if(e&&d){let n=e[1]===`bool`?`bool`:`number`,r=[],i=``,o=0,s=0;for(let t of e[2]){if(t===`,`&&o===0&&s===0){i.trim()&&r.push(i.trim()),i=``;continue}t===`(`&&(o+=1),t===`)`&&(o=Math.max(0,o-1)),t===`{`&&(s+=1),t===`}`&&(s=Math.max(0,s-1)),i+=t}i.trim()&&r.push(i.trim());for(let i of r){let[r]=i.split(`=`),o=r?.trim()||``,s=[];for(let e of o.matchAll(/\[(\d+)\]/g))s.push(Number(e[1]));let c=o.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);if(s.length&&c){let n=p++;this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:n,name:c[1],kind:`array`,elementKind:e[1],length:s[0],dimensions:s,fromLine:t+1,toLine:2**53-1}],D.push(`${a}__wasm_idle_debug_value_addr(${d}, ${n}, (int)((unsigned long long)(${c[1]})));`);continue}if(/[*&]/.test(o))continue;let l=o.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/)?.[1];if(l){if(!m.has(l)){let e=p++;m.set(l,{slot:e,kind:n,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:l,kind:n,fromLine:t+1,toLine:2**53-1}]}if(i.includes(`=`)){let e=m.get(l);e&&D.push(`${a}${e.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${e.slot}, ${l});`)}}}}let r=y.match(/^for\s*\(\s*(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+([A-Za-z_]\w*)\s*=/);if(r&&d){let e=r[1]===`bool`?`bool`:`number`,n=r[2];if(!m.has(n)){let r=p++;m.set(n,{slot:r,kind:e,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:r,name:n,kind:e,fromLine:t+1,toLine:2**53-1}]}}if(!w){for(let[e,t]of g){if(O.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`\\b${n}\\b`).test(y)&&D.push(`${a}__wasm_idle_debug_emit_${t.container}(${d}, ${t.slot}, ${e});`)}for(let[e,n]of m){let r=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);y.startsWith(`for`)&&n.toLine===t+1||(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b`).test(y)||RegExp(`\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${r}\\b`).test(y)||RegExp(`\\b(?:cin|std::cin)\\b[^;]*>>\\s*${r}\\b`).test(y))&&D.push(`${a}${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${n.slot}, ${e});`)}for(let[e,t]of h){if(m.has(e)||g.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b`).test(y)||RegExp(`\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${n}\\b`).test(y)||RegExp(`\\b(?:cin|std::cin)\\b[^;]*>>\\s*${n}\\b`).test(y))&&D.push(`${a}${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${t.slot}, ${e});`)}}/^return\b/.test(y)&&E.push(`${a}__wasm_idle_debug_leave(${d});`)}if(u>0&&l===u&&y===`}`&&E.push(`${a}__wasm_idle_debug_leave(${d});`),x&&d&&(/^(while|if)\s*\(/.test(y)||/^for\s*\(/.test(y))){let e=y.match(/^(while|if|for)\b/)?.[1],r=n.indexOf(e||``),i=r>=0?n.indexOf(`(`,r):-1;if(i>=0){let r=-1,o=0;for(let e=i;e<n.length;e+=1){let t=n[e];if(t===`(`&&(o+=1),t===`)`&&(--o,o===0)){r=e;break}for(let[e,t]of h){if(m.has(e)||g.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);!w&&(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b`).test(y)||RegExp(`\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${n}\\b`).test(y))&&D.push(`${a}${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${t.slot}, ${e});`)}}if(r>i){let a=n.slice(i+1,r);if(e===`for`){let e=[],o=``,c=0;for(let t of a){if(t===`;`&&c===0){e.push(o),o=``;continue}t===`(`&&(c+=1),t===`)`&&(c=Math.max(0,c-1)),o+=t}if(e.push(o),e.length===3&&e[1]?.trim()){let a=e[0].trim(),o=e[2].trim(),c=[],l=[],u=[],f=/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(?:int|float|double|bool|char)\b/.test(a);for(let[e,t]of m){let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`),r=RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b|\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`);!f&&r.test(a)&&c.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`),f&&r.test(a)&&l.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`),r.test(o)&&u.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`)}let p=c.length&&a?`(${a}, ${c.join(`, `)})`:e[0],h=u.length&&o?`(${o}, ${u.join(`, `)})`:e[2];s=n.slice(0,i+1)+`${p}; (${l.length?`${l.join(`, `)}, `:``}__wasm_idle_debug_line(${d}, ${t+1}), (${e[1].trim()})); ${h}`+n.slice(r)}}else{let e=[];if(w){for(let[t,n]of m){let r=t.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b|\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(a)&&e.push(`${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${n.slot}, ${t})`)}for(let[t,n]of h){if(m.has(t)||g.has(t))continue;let r=t.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b|\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(a)&&e.push(`${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${n.slot}, ${t})`)}}let o=e.length?`((${a.trim()}) ? (${e.join(`, `)}, 1) : (${e.join(`, `)}, 0))`:`(${a.trim()})`;s=n.slice(0,i+1)+`(__wasm_idle_debug_line(${d}, ${t+1}), ${o})`+n.slice(r)}}}}T.push(...E),T.push(s),T.push(...D);let j=u===0&&y.includes(`(`)&&y.includes(`)`)&&y.includes(`{`)&&(c.match(/{/g)||[]).length>(c.match(/}/g)||[]).length&&!/^(if|for|while|switch|catch)\b/.test(y)&&!/^(class|struct|namespace|enum|union)\b/.test(y),M=u===0&&!!_&&y===`{`;if(l+=(c.match(/{/g)||[]).length,l-=(c.match(/}/g)||[]).length,j||M){u=l,d=f++;let e=`anonymous`,n=i===`OBJC`&&j?y.match(/^([-+])\s*\([^)]*\)\s*([A-Za-z_]\w*)/):null;if(j?(e=y.slice(0,y.indexOf(`(`)).trim().split(/\s+/).pop()||e,n&&(e=`${n[1]}${n[2]}`)):_&&(e=_.functionName||e),this.debugFunctionMetadata[d]=e,p=1,m=new Map,g=new Map,T.push(`${a}    __wasm_idle_debug_enter(${d}, ${t+1});`),e===`main`){i===`CPP`&&(T.push(`${a}    std::cout.setf(std::ios::unitbuf);`),T.push(`${a}    std::cerr.setf(std::ios::unitbuf);`));let e=i===`CPP`?`nullptr`:`NULL`;T.push(`${a}    setvbuf(stdout, ${e}, _IONBF, 0);`),T.push(`${a}    setvbuf(stderr, ${e}, _IONBF, 0);`)}let r=j?n?``:y.slice(y.indexOf(`(`)+1,y.lastIndexOf(`)`)):_?.parameters||``;for(let e of r.split(`,`).map(e=>e.trim()).filter(Boolean)){let n=e.split(`=`)[0]?.trim()||``,r=n.match(/^(?:const\s+)?(?:(?:std::)?(vector|set|map)\s*<.+>)\s*&?\s*([A-Za-z_]\w*)\s*$/);if(r){let e=p++,n=r[1],i=r[2];g.set(i,{slot:e,container:n,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:i,kind:`text`,fromLine:t+1,toLine:2**53-1}],T.push(`${a}    __wasm_idle_debug_emit_${n}(${d}, ${e}, ${i});`);continue}let i=[];for(let e of n.matchAll(/\[(\d+)\]/g))i.push(Number(e[1]));let o=n.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);if(i.length&&o&&/\b(int|float|double|bool|char)\b/.test(n)){let e=p++;this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:o[1],kind:`array`,elementKind:n.match(/\b(int|float|double|bool|char)\b/)?.[1]||`int`,length:i[0],dimensions:i,fromLine:t+1,toLine:2**53-1}],T.push(`${a}    __wasm_idle_debug_value_addr(${d}, ${e}, (int)((unsigned long long)(${o[1]})));`);continue}if(/[*&\[]/.test(n))continue;let s=n.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);if(!s)continue;let c=s[1],l=/\bbool\b/.test(n)?`bool`:/\b(?:int|float|double|char|short|long)\b/.test(n)?`number`:``;if(!l)continue;let u=p++;m.set(c,{slot:u,kind:l,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:u,name:c,kind:l,fromLine:t+1,toLine:2**53-1}],T.push(`${a}    ${l===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${u}, ${c});`)}_=void 0}else u===0&&y.includes(`(`)&&y.includes(`)`)&&!y.includes(`{`)&&!y.endsWith(`;`)&&!/^(if|for|while|switch|catch)\b/.test(y)&&!/^(class|struct|namespace|enum|union)\b/.test(y)?_={functionName:y.slice(0,y.indexOf(`(`)).trim().split(/\s+/).pop()||`anonymous`,parameters:y.slice(y.indexOf(`(`)+1,y.lastIndexOf(`)`))}:y&&y!==`{`&&(_=void 0);u>0&&l<u&&(u=0,d=0,m=new Map,g=new Map)}S.length&&(i===`CPP`?(T.push(`struct __wasm_idle_debug_globals_init {`),T.push(`    __wasm_idle_debug_globals_init() {`),T.push(...S.map(e=>`        ${e}`)),T.push(`    }`),T.push(`} __wasm_idle_debug_globals_init_instance;`)):(T.push(`__attribute__((constructor)) static void __wasm_idle_debug_globals_init(void) {`),T.push(...S.map(e=>`    ${e}`)),T.push(`}`))),n=T.join(`
`)}else this.debugVariableMetadata={},this.debugGlobalMetadata=[];typeof e.transformSource==`function`&&(n=e.transformSource(n));let u=bt(n);await this.ready,this.addWorkspaceFiles(e.workspaceFiles,t),this.addWorkspaceDirectories(t),this.memfs.addFile(t,u),this.memfs.addFile(r,new Uint8Array);let d=await this.getModule(this.assetUrls.clang),f=this.compilerConfig?.resourceDir||`/lib/clang/8.0.1`,p=`${f.replace(/\/+$/,``)}/include`,m=[`-cc1`,`-triple`,`wasm32-wasi`,`-emit-obj`,`-disable-free`,`-isysroot`,`/`,`-resource-dir`,f,...i===`CPP`?[`-internal-isystem`,`/include/c++/v1`,`-internal-isystem`,p,`-internal-isystem`,`/include/wasm32-wasi`,`-internal-isystem`,`/include`]:[`-internal-isystem`,p,`-internal-isystem`,`/include/wasm32-wasi`,`-internal-isystem`,`/include`],...i===`OBJC`?[`-I.`]:[],`-ferror-limit`,`19`,`-fcolor-diagnostics`,`-O`+l,`-o`,r,s,`-x`,o,...i===`OBJC`?[`-fobjc-runtime=gnustep-2.0`,`-fblocks`]:[],t,...a];this.trace(`compile ${t} -> ${r}`);try{return await this.run(d,!0,`clang`,...m)}catch(e){if(Uint8Array.from(this.memfs.getFileContents(r)).length>0)return this.trace(`recover ${r} after clang output stream exit`),null;throw e}}async link(e,t,n=!1){let r=`lib/wasm32-wasi`,i=this.compilerConfig?.compilerRuntimeLibDir||`lib/clang/8.0.1/lib/wasi`,a=`${r}/crt1.o`;await this.ready;let o=await this.getModule(this.assetUrls.lld);return this.trace(`link ${e} -> ${t}`),await this.run(o,this.log,`wasm-ld`,`--export-dynamic`,...n?[`--allow-undefined`]:[],`-z`,`stack-size=1048576`,`-L${r}/noeh`,`-L${r}`,a,e,`-lc`,`-lc++`,`-lc++abi`,`-lm`,`-L${i}`,`-lclang_rt.builtins-wasm32`,`-o`,t)}async run(e,t,...n){return this.runWithOptions(e,t,n)}async runWithOptions(e,t,n,r={},i,a){this.memfs.out=t,this.hostLog(`${n.join(` `)}\n`),this.trace(`run ${n.join(` `)}`);let o=+new Date,s=new Ge(e,this.memfs,n[0],...n.slice(1),{extraImports:i,instanceRef:a});s.environ={...s.environ,...r},s.trace=e=>this.trace(e),s.debugSession={buffer:this.debugBuffer,interruptBuffer:this.debugInterruptBuffer,watchBuffer:this.debugWatchBuffer,watchResultBuffer:this.debugWatchResultBuffer,breakpoints:new Set(this.debugBreakpoints),breakpointVersion:0,pauseOnEntry:this.debugPauseOnEntry,stepArmed:this.debugPauseOnEntry,nextLineArmed:!1,stepOutArmed:!1,callDepth:0,stepOutDepth:0,currentFunctionId:0,currentLine:0,resumeSkipActive:!1,resumeSkipFunctionId:0,resumeSkipLine:0,nextLineFunctionId:0,nextLineLine:0,variableMetadata:this.debugVariableMetadata,globalVariableMetadata:this.debugGlobalMetadata,functionMetadata:this.debugFunctionMetadata,frames:[],globalValues:new Map,onPause:e=>this.onDebugEvent?.(e)};let c=+new Date,l=await s.run(),u=+new Date;return this.log&&this.stdout(`
`),this.showTiming&&this.stdout(`${at}(${o-c}ms/${u-c}ms)${G}\n`),l?s:null}async compileLink(e,t={}){let{language:n=`CPP`,fileName:r,activePath:i,workspaceFiles:a=[],args:o=[],compileArgs:s=o,debug:c=!1,breakpoints:l=[],pauseOnEntry:u=!1,cppVersion:d,cVersion:f,debugBuffer:p,interruptBuffer:m,watchBuffer:h,watchResultBuffer:g}=t,{input:_,obj:v,wasm:y}=yt(n,q(i||``)||q(r||``)||void 0);this.beginTrace(c),this.debugBreakpoints=new Set(c?l:[]),this.debugPauseOnEntry=c&&u,this.debugBuffer=p,this.debugInterruptBuffer=m,this.debugWatchBuffer=h,this.debugWatchResultBuffer=g,this.lastArtifactPath=y;let b=JSON.stringify({code:e,input:_,wasm:y,language:n,compileArgs:s,workspaceFiles:a,cppVersion:d,cVersion:f,debug:c});if(this.lastBuildKey===b)return this.trace(`reuse ${y}`),this.wasm;await this.compile({input:_,code:e,obj:v,language:n,compileArgs:s,workspaceFiles:a,cppVersion:d,cVersion:f,debug:c}),await this.link(v,y,c),this.lastBuildKey=b;let x=Uint8Array.from(this.memfs.getFileContents(y));return this.wasm=await this.hostLogAsync(`Compiling ${y}`,WebAssembly.compile(x))}async compileLinkRun(e,t={}){let{language:n=`CPP`,fileName:r,activePath:i,workspaceFiles:a=[],args:o=[],compileArgs:s=o,programArgs:c=[],debug:l=!1,breakpoints:u=[],pauseOnEntry:d=!1,cppVersion:f,cVersion:p,debugBuffer:m,interruptBuffer:h,watchBuffer:g,watchResultBuffer:_}=t;this.debug=l;let{wasm:v}=yt(n,q(i||``)||q(r||``)||void 0);return await this.run(await this.compileLink(e,{language:n,fileName:r,activePath:i,workspaceFiles:a,compileArgs:s,debug:l,breakpoints:u,pauseOnEntry:d,cppVersion:f,cVersion:p,debugBuffer:m,interruptBuffer:h,watchBuffer:g,watchResultBuffer:_}),!0,v,...c)}};function J(e,t){if(!e||typeof e!=`object`||Array.isArray(e))throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function Y(e,t){if(typeof e!=`string`||e.length===0)throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function Ct(e,t){if(e!==`wasm32-wasi`)throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function wt(e){let t=J(e,`root.compiler`),n=J(t.sysroot,`root.compiler.sysroot`);return{memfs:{asset:Y(J(t.memfs,`root.compiler.memfs`).asset,`root.compiler.memfs.asset`),argv0:Y(J(t.memfs,`root.compiler.memfs`).argv0,`root.compiler.memfs.argv0`)},clang:{asset:Y(J(t.clang,`root.compiler.clang`).asset,`root.compiler.clang.asset`),argv0:Y(J(t.clang,`root.compiler.clang`).argv0,`root.compiler.clang.argv0`)},lld:{asset:Y(J(t.lld,`root.compiler.lld`).asset,`root.compiler.lld.asset`),argv0:Y(J(t.lld,`root.compiler.lld`).argv0,`root.compiler.lld.argv0`)},sysroot:{asset:Y(n.asset,`root.compiler.sysroot.asset`),...typeof n.runtimeRoot==`string`?{runtimeRoot:n.runtimeRoot}:{}},...t.resourceDir===void 0?{}:{resourceDir:Y(t.resourceDir,`root.compiler.resourceDir`)},...t.compilerRuntimeLibDir===void 0?{}:{compilerRuntimeLibDir:Y(t.compilerRuntimeLibDir,`root.compiler.compilerRuntimeLibDir`)},...typeof t.defaultCppStandard==`string`?{defaultCppStandard:t.defaultCppStandard}:{},...typeof t.defaultCStandard==`string`?{defaultCStandard:t.defaultCStandard}:{}}}function Tt(e){let t=J(e,`root.clangd`);return{js:Y(t.js,`root.clangd.js`),wasm:Y(t.wasm,`root.clangd.wasm`)}}function Et(e,t){let n=J(e,t);if(J(n.execution,`${t}.execution`).kind!==`wasi-preview1`)throw Error(`invalid ${t}.execution.kind in wasm-clang runtime manifest`);if(n.artifactFormat!==`wasi-core-wasm`)throw Error(`invalid ${t}.artifactFormat in wasm-clang runtime manifest`);return{artifactFormat:`wasi-core-wasm`,execution:{kind:`wasi-preview1`}}}function Dt(e){return{"wasm32-wasi":Et(J(e,`root.targets`)[`wasm32-wasi`],`root.targets.wasm32-wasi`)}}function Ot(e){let t=J(e,`root`);if(t.manifestVersion!==1)throw Error(`invalid root.manifestVersion in wasm-clang runtime manifest`);return{manifestVersion:1,version:Y(t.version,`root.version`),defaultTarget:Ct(t.defaultTarget,`root.defaultTarget`),compiler:wt(t.compiler),clangd:Tt(t.clangd),targets:Dt(t.targets)}}async function kt(e,t=fetch){let n=ct(e,`wasm-clang runtime manifest URL`),r=await t(n.toString());if(!r.ok)throw Error(`failed to load wasm-clang runtime manifest from ${n}: ${r.status}`);return Ot(await r.json())}function At(e){return ft(e)}function jt(e){let t=e.replace(/\\/g,`/`),n=t.startsWith(`/`)?t:`/${t}`,r=[];for(let t of n.split(`/`))if(!(!t||t===`.`)){if(t===`..`)throw Error(`wasm-clang does not allow guest path traversal: ${e}`);r.push(t)}return`/${r.join(`/`)}`}function Mt(e){return typeof e==`string`?new TextEncoder().encode(e):(e instanceof Uint8Array,new Uint8Array(e))}var Nt=class extends m{ino=h.issue_ino();decoder=new TextDecoder;chunks=[];output;constructor(e){super(),this.output=e}fd_filestat_get(){return{ret:0,filestat:new i(this.ino,2,0n)}}fd_fdstat_get(){let e=new r(2,0);return e.fs_rights_base=BigInt(64),{ret:0,fdstat:e}}fd_write(e){let t=this.decoder.decode(e,{stream:!0});return this.chunks.push(t),this.output?.(t),{ret:0,nwritten:e.byteLength}}getText(){let e=this.decoder.decode();return e&&(this.chunks.push(e),this.output?.(e)),this.chunks.join(``)}},Pt=class{currentChunk=new Uint8Array;currentOffset=0;readInput;constructor(e){this.readInput=e}read(e){for(;this.currentOffset>=this.currentChunk.length;){let e=this.readInput?.();if(e==null)return new Uint8Array;this.currentChunk=Mt(e),this.currentOffset=0,this.currentChunk.byteLength}let t=this.currentChunk.slice(this.currentOffset,this.currentOffset+e);return this.currentOffset+=t.byteLength,t}},Ft=class extends m{ino=h.issue_ino();source;constructor(e){super(),this.source=e}fd_filestat_get(){return{ret:0,filestat:new i(this.ino,2,0n)}}fd_fdstat_get(){let e=new r(2,0);return e.fs_rights_base=BigInt(2),{ret:0,fdstat:e}}fd_read(e){return{ret:0,data:this.source.read(e)}}};function It(e={}){let t=new x(new Map);for(let n of e.files||[]){let e=jt(n.path).slice(1).split(`/`),r=t;for(let t of e.slice(0,-1)){let e=r.contents.get(t);if(e instanceof x){r=e;continue}let n=new x(new Map);r.contents.set(t,n),r=n}r.contents.set(e.at(-1),new y(Mt(n.contents)))}let n=new Pt(e.stdin),r=new Nt(e.stdout),i=new Nt(e.stderr),a=new Map([[`PWD`,`/`]]);for(let[t,n]of Object.entries(e.env||{}))a.set(t,n);return{args:[e.programName||`main.wasm`,...e.args||[]],envEntries:Array.from(a.entries()).map(([e,t])=>`${e}=${t}`),rootDirectory:t,stdout:r,stderr:i,fds:[new Ft(n),r,i,new v(`/tmp`,new Map),new v(`/`,t.contents)]}}async function Lt(e,t={}){if(e.target!==`wasm32-wasi`||e.format!==`wasi-core-wasm`)throw Error(`wasm-clang currently executes only wasm32-wasi preview1 core wasm artifacts.`);let n=It({...t,programName:t.programName||e.fileName}),r=new p(n.args,n.envEntries,n.fds,{debug:!1}),i=(e.bytes instanceof Uint8Array,new Uint8Array(e.bytes)),a=e.wasm||await WebAssembly.compile(i),o={current:null},s=typeof t.extraImports==`function`?await t.extraImports({host:n,module:a,instance:o}):t.extraImports||{},c=await WebAssembly.instantiate(a,{...s,wasi_unstable:r.wasiImport,wasi_snapshot_preview1:r.wasiImport});return o.current=c,{exitCode:r.start(c),stdout:n.stdout.getText(),stderr:n.stderr.getText()}}self.document={querySelectorAll(){return[]}};const Rt=new TextDecoder;let zt=null,X=null,Z=null,Q=!1,Bt=null,$=!1;const Vt=e=>e.replaceAll(`\\`,`/`).split(`/`).filter(e=>e&&e!==`.`&&e!==`..`).join(`/`),Ht=e=>e.split(`/`).pop()||e,Ut=e=>Ht(e).replace(/\.[^.]+$/,``)||`main`,Wt=e=>e.endsWith(`
`)?e:`${e}\n`,Gt=e=>{let t=Vt(e||``);return t?/\.[A-Za-z0-9_-]+$/.test(t)?t:`${t}.f`:`main.f`};async function Kt(e,t){let n=await fetch(e);if(!n.ok)throw Error(`Failed to load ${t}: ${n.status}`);return new Uint8Array(await n.arrayBuffer())}async function qt(e,t){return Rt.decode(await Kt(e,t))}async function Jt(e,t,n){fe(e||null);let r=e?.baseUrl||``;X=new St({stdout:e=>postMessage({output:e}),stdin:()=>``,progress:e=>postMessage({progress:e}),log:n,runtimeBaseUrl:r,manifest:await kt(At(r))});let[i,a,o]=await Promise.all([Kt(t.f2cWasmUrl,`f2c.wasm`),Kt(t.libf2cUrl,`libf2c.a`),qt(t.f2cHeaderUrl,`f2c.h`)]);Z=await WebAssembly.compile(i),await X.ready,X.memfs.addFile(`f2c.h`,o),X.memfs.addFile(`libf2c.a`,a)}function Yt(){return Q?$?null:($=!0,Bt??``):k(zt,()=>postMessage({buffer:!0}))}function Xt(e,t,n=[]){let r=new Map;for(let e of n){let t=Vt(e.path);t&&r.set(t,e.content)}return r.set(t,Wt(e)),Array.from(r,([e,t])=>({path:e,contents:t}))}function Zt(e,t){let n=Vt(t).split(`/`).filter(Boolean),r=e.rootDirectory;for(let e of n)if(r=r?.contents?.get(e),!r)return null;let i=r?.data;return i instanceof Uint8Array||i instanceof ArrayBuffer?new Uint8Array(i):null}function Qt(e,t=``){for(let[n,r]of e.contents||[]){let e=t?`${t}/${n}`:n;if(r?.contents){let t=Qt(r,e);if(t)return t;continue}if(e.endsWith(`.c`)&&r?.data instanceof Uint8Array)return new Uint8Array(r.data)}return null}async function $t(e,t,n){if(!Z)throw Error(`Fortran runtime is not loaded.`);let r=Gt(t),i=`${Ut(r)}.c`,a=[],o=[],s=It({args:[r],env:{TMPDIR:`/tmp`},files:Xt(e,r,n),programName:`f2c.wasm`,stdout:e=>a.push(e),stderr:e=>o.push(e)}),c=new p(s.args,s.envEntries,s.fds,{debug:!1}),l=await WebAssembly.instantiate(Z,{wasi_snapshot_preview1:c.wasiImport,wasi_unstable:c.wasiImport}),u=c.start(l),d=a.join(``),f=o.join(``);if(u)throw Error(`f2c exited with ${u}${f?`\n${f}`:``}`);let m=Zt(s,i)||Qt(s.rootDirectory);if(!m)throw Error(`f2c did not produce ${i}${f||d?`\n${f}${d}`:``}`);return{cPath:i,cSource:Rt.decode(m)}}async function en(e,t,n=[]){if(!X)throw Error(`Fortran clang backend is not loaded.`);let r=`${Ut(e)}.o`,i=`f2c_compat.o`,a=`${Ut(e)}.wasm`;await X.compile({input:e,code:t,obj:r,language:`C`,compileArgs:[`-I.`,`-w`,...n]}),await X.compile({input:`f2c_compat.c`,code:`#include <stdarg.h>
#include <stdio.h>

typedef void (*sighandler_t)(int);

int fiprintf(FILE *stream, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    int result = vfprintf(stream, format, ap);
    va_end(ap);
    return result;
}

int siprintf(char *str, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    int result = vsprintf(str, format, ap);
    va_end(ap);
    return result;
}

int __small_sprintf(char *str, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    int result = vsprintf(str, format, ap);
    va_end(ap);
    return result;
}

sighandler_t signal(int signum, sighandler_t handler) {
    (void)signum;
    return handler;
}

FILE *tmpfile(void) {
    return NULL;
}
`,obj:i,language:`C`,compileArgs:[`-w`]});let o=`lib/wasm32-wasi`,s=X.compilerConfig?.compilerRuntimeLibDir||`lib/clang/8.0.1/lib/wasi`,c=await X.getModule(X.assetUrls.lld);await X.run(c,X.log,`wasm-ld`,`--export-dynamic`,`-z`,`stack-size=1048576`,`-L${o}/noeh`,`-L${o}`,`${o}/crt1.o`,r,i,`libf2c.a`,`-lc`,`-lm`,`-L${s}`,`-lclang_rt.builtins-wasm32`,`-o`,a);let l=Uint8Array.from(X.memfs.getFileContents(a));return{bytes:l,wasm:await WebAssembly.compile(l),target:`wasm32-wasi`,format:`wasi-core-wasm`,fileName:a,language:`C`}}self.onmessage=async e=>{if(pe(e.data))return;let{code:t,buffer:n,load:r,log:i,prepare:a,compileArgs:o,programArgs:s,activePath:c,workspaceFiles:l,stdin:u,clangAssets:d,fortranAssets:f}=e.data;if(r)try{await Jt(d,f,i),postMessage({load:!0})}catch(e){postMessage({error:e.message})}else if(typeof i==`boolean`&&!t)X&&(X.log=i);else if(t){if(!X){postMessage({error:`Fortran runtime is not loaded.`});return}X.log=i,zt=new Int32Array(n),Q=typeof u==`string`,Bt=Q?u:null,$=!1;try{let e=await $t(t,c,l||[]),n=await en(e.cPath,e.cSource,o||[]);if(!a){let e=await Lt(n,{args:s||[],stdin:Yt,stdout:e=>postMessage({output:e}),stderr:e=>postMessage({output:e})});if(e.exitCode)throw Error(`Fortran program exited with ${e.exitCode}`)}postMessage({results:!0})}catch(e){postMessage({error:e.message})}}};