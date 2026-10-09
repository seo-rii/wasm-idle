/** Bounded previews must limit work before conversion, not truncate a full repr afterwards. */
export const PYTHON_DEBUG_PREVIEW = String.raw`
def __wasm_idle_debug_preview(value, depth = 0):
    if depth >= 2:
        return "..."
    kind = type(value)
    if value is None:
        return "None"
    if kind is bool:
        return "True" if value else "False"
    if kind is int:
        bits = value.bit_length()
        return repr(value) if bits <= 256 else "<int: " + str(bits) + " bits>"
    if kind in (float, complex):
        return repr(value)
    if kind in (bytes, bytearray, str):
        prefix = value[:32]
        text = repr(bytes(prefix) if kind is bytearray else prefix)
        if len(value) > 32:
            text += "..."
        return text if len(text) <= 80 else text[:77] + "..."
    if kind in (list, tuple):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("...")
        if kind is tuple:
            if len(value) == 1:
                return "(" + items[0] + ",)"
            return "(" + ", ".join(items) + ")"
        return "[" + ", ".join(items) + "]"
    if kind is dict:
        from itertools import islice
        items = [__wasm_idle_debug_preview(key, depth + 1) + ": " + __wasm_idle_debug_preview(item, depth + 1)
                 for key, item in islice(value.items(), 6)]
        if len(value) > 6:
            items.append("...")
        return "{" + ", ".join(items) + "}"
    if kind in (set, frozenset):
        from itertools import islice
        if not value:
            return "set()" if kind is set else "frozenset()"
        # Set iteration order is intentionally retained: sorting would inspect every element.
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in islice(value, 6)]
        if len(value) > 6:
            items.append("...")
        text = "{" + ", ".join(items) + "}"
        return text if kind is set else "frozenset(" + text + ")"
    # Automatic locals must not execute arbitrary user __repr__/container overrides.
    # Explicit watch expressions remain available for user-requested evaluation.
    try:
        name = type.__getattribute__(kind, "__name__")[:64]
        return "<" + name + " object>"
    except Exception:
        return "<object>"
`;
