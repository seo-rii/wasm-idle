let () =
  Yojson.Safe.from_string "{\"hello\":1}"
  |> Yojson.Safe.to_string
  |> print_endline
