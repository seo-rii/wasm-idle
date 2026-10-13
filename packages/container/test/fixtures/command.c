typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(fd_write) int fd_write(int, const iovec *, int, u32 *);
WASI(fd_read) int fd_read(int, const iovec *, int, u32 *);
WASI(args_sizes_get) int args_sizes_get(u32 *, u32 *);
WASI(args_get) int args_get(char **, char *);
WASI(environ_sizes_get) int environ_sizes_get(u32 *, u32 *);
WASI(environ_get) int environ_get(char **, char *);
WASI(path_open) int path_open(int,u32,const char*,u32,u32,u64,u64,u32,u32*);
WASI(fd_close) int fd_close(int);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
static u32 length(const char *s) { u32 n=0; while (s[n]) n++; return n; }
static int equal(const char *a,const char*b) { while (*a && *a==*b) {a++;b++;} return *a==*b; }
static void write(int fd, void *b, u32 n) { iovec v={b,n};u32 done=0; if(fd_write(fd,&v,1,&done)||done!=n)proc_exit(91); }
static char argbytes[4096],envbytes[4096],buffer[1024];
static char *argv[128],*env[128];
static void file(const char *name) {
 u32 fd;
 if(path_open(3,0,name,length(name),9,66,0,0,&fd))proc_exit(92);
 write(fd,"saved",5); if(fd_close(fd))proc_exit(93);
}
__attribute__((export_name("_start"))) void _start(void) {
 char cwd[4096]; int cwd_length = initial_cwd(cwd, sizeof(cwd));
 if (cwd_length < 2 || cwd_length > sizeof(cwd) || cwd[0] != '/' || cwd[cwd_length-1]) proc_exit(125);
 /* This no-libc ABI fixture uses the host's cwd directory preopen directly.
    libc-linked producers must call real chdir(cwd) before their main function. */
 u32 argc,as,ec,es;args_sizes_get(&argc,&as);environ_sizes_get(&ec,&es);
 if(argc>128||as>4096||ec>128||es>4096)proc_exit(90);
 args_get(argv,argbytes);environ_get(env,envbytes);
 const char *mode=argc>1?argv[1]:"echo";
 if(equal(mode,"loop")){volatile u32 n=1;while(n)n=n+1?n+1:1;}
 if(equal(mode,"exit")){file("partial");proc_exit(23);}
 if(equal(mode,"crash")){file("crash");__builtin_trap();}
 if(equal(mode,"flood")){for(u32 i=0;i<1024;i++)buffer[i]=(char)i;for(u32 i=0;i<64;i++){write(1,buffer,1024);write(2,buffer,1024);}return;}
 if(equal(mode,"bad")){iovec v={buffer,8};int e=fd_write(1,&v,1,(u32*)0xfffffff0);proc_exit(e==21?0:94);}
 if(equal(mode,"roundtrip")){write(1,argbytes,as);write(2,envbytes,es);file("out.bin");return;}
 for(;;){iovec v={buffer,sizeof(buffer)};u32 n=0;if(fd_read(0,&v,1,&n))proc_exit(95);if(!n)break;write(1,buffer,n);}
}
