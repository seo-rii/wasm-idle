// This bridge is compiled by the real Scala compiler alongside every user request.
export const runnerSource = `import java.io.{StringReader, OutputStream, PrintStream}
import scala.scalajs.js
import scala.scalajs.js.annotation.JSExportTopLevel
import scala.scalajs.js.JSConverters.*

object WasmIdleScalaRunner:
  private final class TerminalStream(stream: String) extends OutputStream:
    override def write(value: Int): Unit =
      js.Dynamic.global.wasmIdleScalaWriteBytes(stream, js.Array(value & 255))
    override def write(buffer: Array[Byte], offset: Int, length: Int): Unit =
      val bytes = new js.Array[Int]()
      var index = offset
      while index < offset + length do
        bytes.push(buffer(index) & 255)
        index += 1
      js.Dynamic.global.wasmIdleScalaWriteBytes(stream, bytes)
    override def flush(): Unit = ()
    override def close(): Unit = ()

  @JSExportTopLevel("runWasmIdleScala")
  def run(input: String, args: js.Array[String]): Unit =
    val out = new PrintStream(new TerminalStream("stdout"), true, "UTF-8")
    val err = new PrintStream(new TerminalStream("stderr"), true, "UTF-8")
    try
      scala.Console.withIn(new StringReader(input)) {
        scala.Console.withOut(out) {
          scala.Console.withErr(err) {
            Main.main(args.toArray)
          }
        }
      }
    finally
      out.flush()
      err.flush()
`;
