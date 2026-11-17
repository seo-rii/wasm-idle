(* WASI host for the original HaMLet implementation. *)
val basisDirectory = "/.wasm-idle-sml-basis"

fun installBasis (name, source) =
  let
    val file = TextIO.openOut (basisDirectory ^ "/" ^ name)
  in
    TextIO.output (file, source);
    TextIO.closeOut file
  end

val () =
  (case CommandLine.arguments () of
     path :: _ =>
       (OS.FileSys.mkDir basisDirectory;
        List.app installBasis embeddedBasis;
        OS.Process.exit
          (if Sml.runFile (basisDirectory, path)
           then OS.Process.success else OS.Process.failure))
   | [] =>
       (TextIO.output (TextIO.stdErr, "usage: sml <source.sml> [arguments]\n");
        OS.Process.exit OS.Process.failure))
  handle error =>
    (TextIO.output
       (TextIO.stdErr, "SML host error: " ^ General.exnName error ^ "\n");
     OS.Process.exit OS.Process.failure)
