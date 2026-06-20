program wasm_idle_pascal_compiler;

{$mode objfpc}

uses
  Classes, SysUtils, JS, webfilecache, pas2jswebcompiler;

var
  Compiler: TPas2JSWebCompiler;
  LastLog: TStringList;

type
  TLogSink = class
    procedure LogMessage(Sender: TObject; const Msg: String);
  end;

var
  LogSink: TLogSink;

procedure TLogSink.LogMessage(Sender: TObject; const Msg: String);
begin
  if LastLog<>nil then
    LastLog.Add(Msg);
end;

procedure EnsureCompiler;
begin
  if Compiler<>nil then
    exit;
  if LogSink=nil then
    LogSink:=TLogSink.Create;
  Compiler:=TPas2JSWebCompiler.Create;
  Compiler.Log.OnLog:=@LogSink.LogMessage;
end;

procedure SetFile(Name, Content: String); public;
begin
  EnsureCompiler;
  Compiler.WebFS.SetFileContent(Name, Content);
end;

function Compile(Source: String): String; public;
var
  Args: TStringList;
begin
  EnsureCompiler;
  LastLog:=TStringList.Create;
  Args:=TStringList.Create;
  try
    Compiler.WebFS.SetFileContent('main.pas', Source);
    Args.Add('-n');
    Args.Add('-MObjFPC');
    Args.Add('-Tbrowser');
    Args.Add('-Jc');
    Args.Add('-Jirtl.js');
    Args.Add('main.pas');
    Compiler.ExitCode:=0;
    Compiler.Run('', '', Args, False);
    if Compiler.ExitCode<>0 then
      raise Exception.Create(LastLog.Text);
    Result:=Compiler.WebFS.GetFileContent('main.js');
  finally
    Args.Free;
    LastLog.Free;
    LastLog:=nil;
  end;
end;

begin
  asm
    var root = (typeof globalThis !== 'undefined') ? globalThis : self;
    root.__wasmIdlePascalCompiler = {
      setFile: function(name, content) { pas.program.SetFile(String(name), String(content)); },
      compile: function(source) { return pas.program.Compile(String(source)); }
    };
  end;
end.
