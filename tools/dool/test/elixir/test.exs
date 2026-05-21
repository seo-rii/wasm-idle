defmodule Main do
  def format1(x) do
    rounded = Float.round(x, 1)

    if abs(rounded - trunc(rounded)) < 1.0e-9 do
      Integer.to_string(trunc(rounded))
    else
      :erlang.float_to_binary(rounded, decimals: 1)
    end
  end
end

[n | rest] =
  IO.read(:stdio, :all)
  |> String.split()
  |> Enum.map(&String.to_integer/1)

values = Enum.take(rest, n)
total = Enum.sum(values)
count = length(values)
mean = total / count

variance =
  Enum.reduce(values, 0.0, fn x, acc ->
    diff = x - mean
    acc + diff * diff
  end) / count

stddev = :math.sqrt(variance)

IO.puts(total)
IO.puts(Main.format1(mean))
IO.puts(Main.format1(stddev))
