export const stdModuleCases = [
	{
		id: 'multiple-tu',
		stdin: '4 9 1 5 3\n',
		stdout: '18 1 9 gcc-wasi:18 7\n',
		sources: {
			'main.cpp': `import std;
int sum(const std::vector<int>&); std::string label(int); int compat();
int main(){int n;if(std::scanf("%d",&n)!=1)return 1;std::vector<int> v(n);
for(int&x:v)if(std::scanf("%d",&x)!=1)return 2;std::sort(v.begin(),v.end());
int s=sum(v);auto t=label(s);int c=compat();
std::printf("%d %d %d %s %d\\n",s,v.front(),v.back(),t.c_str(),c);return c==7?0:3;}
`,
			'header.cpp':
				'#include <vector>\n#include <numeric>\nint sum(const std::vector<int>&v){return std::accumulate(v.begin(),v.end(),0);}\n',
			'module.cpp':
				'import std;\nstd::string label(int n){return std::string("gcc-wasi:")+std::to_string(n);}\n',
			'compat.cpp': `import std.compat;
int compat(){char text[20];int n=snprintf(text,sizeof text,"std:%d",abs(-23));
return (n==6?1:0)|(strlen(text)==6?2:0)|(strcmp(text,"std:23")==0?4:0);}
`
		}
	},
	{
		id: 'iostream',
		stdin: '44\n',
		stdout: '45\n',
		sources: {
			'main.cpp':
				'import std;\nint main(){int n;if(!(std::cin>>n))return 1;std::cout<<n+1<<"\\n";}\n'
		}
	},
	{
		id: 'signal-emulation',
		stdin: '',
		stdout: 'signal 0\n',
		sources: {
			'main.cpp':
				'#include <csignal>\nimport std.compat;\nint main(){auto old=signal(SIGINT,SIG_IGN);if(old==SIG_ERR)return 1;int n=raise(SIGINT);printf("signal %d\\n",n);return n==0?0:2;}\n'
		}
	},
	{
		// O2 can remove ordinary imports' initializer references. Refer to the real
		// generated symbols to test this link contract, without providing a stub.
		id: 'module-initializers',
		stdin: '',
		stdout: 'initializers\n',
		sources: {
			'main.cpp':
				'import std.compat;\nextern "C" void std_init() asm("_ZGIW3std");\nextern "C" void compat_init() asm("_ZGIW3stdW6compat");\nint main(){std_init();compat_init();puts("initializers");}\n'
		}
	}
];

export const unsupportedSetjmp =
	'#include <csetjmp>\nimport std;\nstd::jmp_buf jump;\nint main(){int n=setjmp(jump);if(n==0)std::longjmp(jump,23);std::printf("jump %d\\n",n);return n==23?0:1;}\n';
