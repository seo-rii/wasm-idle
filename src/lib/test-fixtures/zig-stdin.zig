const std = @import("std");

pub fn main(init: std.process.Init) !void {
    var input_buffer: [32]u8 = undefined;
    var stdin = std.Io.File.stdin().readerStreaming(init.io, &input_buffer);
    const input = (try stdin.interface.takeDelimiter('\n')) orelse "0";
    const n = try std.fmt.parseInt(i32, std.mem.trim(u8, input, " \t\r\n"), 10);

    var output_buffer: [32]u8 = undefined;
    var stdout = std.Io.File.stdout().writerStreaming(init.io, &output_buffer);
    try stdout.interface.print("main={d}\n", .{n + 5});
    try stdout.interface.flush();
}
