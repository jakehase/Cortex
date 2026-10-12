"""L4 Lab: deterministic, exact calculation without code execution.

Expressions are parsed with :mod:`ast` and evaluated by walking a strict
whitelist of node types.  Nothing is ever passed to ``eval``/``exec`` and no
attribute access, names (other than a few constants), subscripts, comprehensions
or lambdas are accepted.  Integers are exact (arbitrary precision); in exact
mode decimal literals and division are evaluated as rationals.  Every resource
dimension is bounded: expression length, AST size, exponent size, result size
and list sizes, so a hostile expression fails fast with a clear error.
"""

from __future__ import annotations

import ast
import math
import re
import statistics
from fractions import Fraction
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

MAX_EXPRESSION_CHARS = 2_000
MAX_AST_NODES = 600
MAX_EXPONENT = 10_000
MAX_RESULT_BITS = 14_000          # ~4,200 decimal digits (below Python's int->str limit)
MAX_LIST_ITEMS = 10_000
MAX_FACTORIAL = 2_000
MAX_COMB_N = 100_000
MAX_DECIMAL_DIGITS = 60

Number = Union[int, float, Fraction]


class LabComputeError(ValueError):
    """The expression is unsupported, malformed, or exceeds a bound."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


_CONSTANTS: Dict[str, float] = {"pi": math.pi, "e": math.e, "tau": math.tau}


def _num(value: Any) -> Number:
    if isinstance(value, bool) or not isinstance(value, (int, float, Fraction)):
        raise LabComputeError("type_error", "operands must be numbers")
    return value


def _as_float(value: Number) -> float:
    try:
        return float(value)
    except OverflowError as exc:
        raise LabComputeError("bound_exceeded", "value too large for floating-point function") from exc


def _check_size(value: Number) -> Number:
    if isinstance(value, int) and value.bit_length() > MAX_RESULT_BITS:
        raise LabComputeError("bound_exceeded", "integer result exceeds the size limit")
    if isinstance(value, Fraction) and (
        value.numerator.bit_length() > MAX_RESULT_BITS or value.denominator.bit_length() > MAX_RESULT_BITS
    ):
        raise LabComputeError("bound_exceeded", "rational result exceeds the size limit")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise LabComputeError("domain_error", "result is not a finite number")
    return value


def _normalize(value: Number) -> Number:
    if isinstance(value, Fraction) and value.denominator == 1:
        return int(value.numerator)
    return value


def _int_arg(value: Number, name: str) -> int:
    value = _normalize(value)
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int):
        raise LabComputeError("type_error", f"{name} requires integer arguments")
    return value


def _flatten(args: Sequence[Any]) -> List[Number]:
    values: List[Number] = []
    for arg in args:
        if isinstance(arg, list):
            values.extend(_num(v) for v in arg)
        else:
            values.append(_num(arg))
        if len(values) > MAX_LIST_ITEMS:
            raise LabComputeError("bound_exceeded", "too many values")
    if not values:
        raise LabComputeError("domain_error", "at least one value is required")
    return values


def _float_fn(fn: Callable[..., float], arity: Sequence[int]) -> Callable[..., Number]:
    def call(*args: Any) -> Number:
        if len(args) not in arity:
            raise LabComputeError("arity_error", f"expected {'/'.join(map(str, arity))} argument(s)")
        try:
            return fn(*(_as_float(_num(a)) for a in args))
        except (ValueError, ZeroDivisionError) as exc:
            raise LabComputeError("domain_error", f"math domain error: {exc}") from exc
        except OverflowError as exc:
            raise LabComputeError("bound_exceeded", "floating-point overflow") from exc
    call.inexact = True  # type: ignore[attr-defined]
    return call


def _factorial(n: Number) -> int:
    n = _int_arg(n, "factorial")
    if n < 0 or n > MAX_FACTORIAL:
        raise LabComputeError("bound_exceeded", f"factorial argument must be 0..{MAX_FACTORIAL}")
    return math.factorial(n)


def _comb(n: Number, k: Number) -> int:
    n, k = _int_arg(n, "comb"), _int_arg(k, "comb")
    if n < 0 or k < 0 or n > MAX_COMB_N:
        raise LabComputeError("bound_exceeded", f"comb requires 0 <= k and 0 <= n <= {MAX_COMB_N}")
    return math.comb(n, k)


def _perm(n: Number, k: Optional[Number] = None) -> int:
    n = _int_arg(n, "perm")
    kk = None if k is None else _int_arg(k, "perm")
    if n < 0 or n > MAX_COMB_N or (kk is not None and kk < 0):
        raise LabComputeError("bound_exceeded", f"perm requires 0 <= n <= {MAX_COMB_N}")
    if kk is None and n > MAX_FACTORIAL:
        raise LabComputeError("bound_exceeded", "perm(n) is bounded like factorial")
    return math.perm(n, kk)


def _round(x: Number, ndigits: Optional[Number] = None) -> Number:
    x = _num(x)
    if ndigits is None:
        return round(x)
    nd = _int_arg(ndigits, "round")
    if abs(nd) > 100:
        raise LabComputeError("bound_exceeded", "round digits must be within +/-100")
    return round(x, nd)


def _log(x: Number, base: Optional[Number] = None) -> float:
    try:
        if base is None:
            return math.log(_as_float(_num(x))) if not isinstance(x, int) else math.log(x)
        return math.log(x if isinstance(x, int) else _as_float(_num(x)), _as_float(_num(base)))
    except (ValueError, ZeroDivisionError) as exc:
        raise LabComputeError("domain_error", f"math domain error: {exc}") from exc


_log.inexact = True  # type: ignore[attr-defined]


def _stat(fn: Callable[[List[Number]], Number], minimum: int = 1) -> Callable[..., Number]:
    def call(*args: Any) -> Number:
        values = _flatten(args)
        if len(values) < minimum:
            raise LabComputeError("domain_error", f"needs at least {minimum} values")
        try:
            return fn(values)
        except statistics.StatisticsError as exc:
            raise LabComputeError("domain_error", str(exc)) from exc
    return call


def _gcd(*args: Number) -> int:
    return math.gcd(*(_int_arg(a, "gcd") for a in _flatten(args)))


def _lcm(*args: Number) -> int:
    return math.lcm(*(_int_arg(a, "lcm") for a in _flatten(args)))


_FUNCTIONS: Dict[str, Callable[..., Number]] = {
    "sqrt": _float_fn(math.sqrt, (1,)),
    "cbrt": _float_fn(lambda x: math.copysign(abs(x) ** (1.0 / 3.0), x), (1,)),
    "exp": _float_fn(math.exp, (1,)),
    "log": _log,
    "ln": _float_fn(math.log, (1,)),
    "log10": _float_fn(math.log10, (1,)),
    "log2": _float_fn(math.log2, (1,)),
    "sin": _float_fn(math.sin, (1,)),
    "cos": _float_fn(math.cos, (1,)),
    "tan": _float_fn(math.tan, (1,)),
    "asin": _float_fn(math.asin, (1,)),
    "acos": _float_fn(math.acos, (1,)),
    "atan": _float_fn(math.atan, (1,)),
    "atan2": _float_fn(math.atan2, (2,)),
    "sinh": _float_fn(math.sinh, (1,)),
    "cosh": _float_fn(math.cosh, (1,)),
    "tanh": _float_fn(math.tanh, (1,)),
    "degrees": _float_fn(math.degrees, (1,)),
    "radians": _float_fn(math.radians, (1,)),
    "hypot": _float_fn(math.hypot, (2, 3)),
    "abs": lambda x: abs(_num(x)),
    "round": _round,
    "floor": lambda x: math.floor(_num(x)),
    "ceil": lambda x: math.ceil(_num(x)),
    "trunc": lambda x: math.trunc(_num(x)),
    "factorial": _factorial,
    "comb": _comb,
    "perm": _perm,
    "gcd": _gcd,
    "lcm": _lcm,
    "min": lambda *a: min(_flatten(a)),
    "max": lambda *a: max(_flatten(a)),
    "sum": lambda *a: sum(_flatten(a)),
    "mean": _stat(statistics.mean),
    "median": _stat(statistics.median),
    "mode": _stat(statistics.mode),
    "stdev": _stat(statistics.stdev, 2),
    "pstdev": _stat(statistics.pstdev),
    "variance": _stat(statistics.variance, 2),
    "pvariance": _stat(statistics.pvariance),
}
for _name in ("stdev", "pstdev"):
    _FUNCTIONS[_name].inexact = True  # type: ignore[attr-defined]


class _Evaluator:
    def __init__(self, *, exact: bool, caret_is_power: bool):
        self.exact = exact
        self.caret_is_power = caret_is_power
        self.inexact_ops: List[str] = []

    def eval(self, node: ast.AST) -> Any:
        method = getattr(self, f"_eval_{type(node).__name__}", None)
        if method is None:
            raise LabComputeError("unsupported_syntax", f"unsupported syntax: {type(node).__name__}")
        return method(node)

    def _eval_Expression(self, node: ast.Expression) -> Any:
        return self.eval(node.body)

    def _eval_Constant(self, node: ast.Constant) -> Number:
        value = node.value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise LabComputeError("unsupported_syntax", "only numeric literals are allowed")
        if isinstance(value, float) and self.exact:
            segment = getattr(node, "_source", None)
            try:
                return Fraction(segment) if segment else Fraction(repr(value))
            except (ValueError, ZeroDivisionError):
                return Fraction(value)
        return value

    def _eval_Name(self, node: ast.Name) -> Number:
        if node.id in _CONSTANTS:
            self.inexact_ops.append(node.id)
            return _CONSTANTS[node.id]
        raise LabComputeError("unsupported_name", f"unknown name: {node.id}")

    def _eval_List(self, node: ast.List) -> List[Number]:
        if len(node.elts) > MAX_LIST_ITEMS:
            raise LabComputeError("bound_exceeded", "too many list items")
        return [_num(self.eval(elt)) for elt in node.elts]

    _eval_Tuple = _eval_List  # type: ignore[assignment]

    def _eval_UnaryOp(self, node: ast.UnaryOp) -> Number:
        operand = _num(self.eval(node.operand))
        if isinstance(node.op, ast.UAdd):
            return +operand
        if isinstance(node.op, ast.USub):
            return -operand
        raise LabComputeError("unsupported_syntax", "unsupported unary operator")

    def _divide(self, left: Number, right: Number) -> Number:
        if right == 0:
            raise LabComputeError("domain_error", "division by zero")
        if self.exact and not isinstance(left, float) and not isinstance(right, float):
            return Fraction(left) / Fraction(right)
        if isinstance(left, int) and isinstance(right, int) and left % right == 0:
            return left // right
        return _as_float(left) / _as_float(right)

    def _power(self, base: Number, exponent: Number) -> Number:
        exponent = _normalize(exponent)
        if isinstance(exponent, int):
            if abs(exponent) > MAX_EXPONENT:
                raise LabComputeError("bound_exceeded", f"exponent magnitude exceeds {MAX_EXPONENT}")
            base_n = _normalize(base)
            if isinstance(base_n, (int, Fraction)):
                parts = (base_n.numerator, base_n.denominator) if isinstance(base_n, Fraction) else (base_n,)
                bits = max(math.log2(abs(part)) if part else 0.0 for part in parts)
                if bits * abs(exponent) > MAX_RESULT_BITS:
                    raise LabComputeError("bound_exceeded", "power result exceeds the size limit")
                if exponent < 0:
                    if base_n == 0:
                        raise LabComputeError("domain_error", "zero cannot be raised to a negative power")
                    if self.exact or isinstance(base_n, Fraction):
                        return Fraction(base_n) ** exponent
                    return _as_float(base_n) ** exponent
                return base_n ** exponent
        try:
            result = _as_float(base) ** _as_float(exponent)
        except (OverflowError, ZeroDivisionError) as exc:
            raise LabComputeError("bound_exceeded", "power overflow or division by zero") from exc
        if isinstance(result, complex):
            raise LabComputeError("domain_error", "result is complex")
        self.inexact_ops.append("pow")
        return result

    def _eval_BinOp(self, node: ast.BinOp) -> Number:
        left = _num(self.eval(node.left))
        right = _num(self.eval(node.right))
        op = node.op
        if isinstance(op, ast.Add):
            result = left + right
        elif isinstance(op, ast.Sub):
            result = left - right
        elif isinstance(op, ast.Mult):
            if isinstance(left, int) and isinstance(right, int) and \
                    left.bit_length() + right.bit_length() > MAX_RESULT_BITS:
                raise LabComputeError("bound_exceeded", "product exceeds the size limit")
            result = left * right
        elif isinstance(op, ast.Div):
            result = self._divide(left, right)
        elif isinstance(op, ast.FloorDiv):
            if right == 0:
                raise LabComputeError("domain_error", "division by zero")
            result = left // right
        elif isinstance(op, ast.Mod):
            if right == 0:
                raise LabComputeError("domain_error", "modulo by zero")
            result = left % right
        elif isinstance(op, ast.Pow) or (isinstance(op, ast.BitXor) and self.caret_is_power):
            result = self._power(left, right)
        else:
            raise LabComputeError("unsupported_syntax", f"unsupported operator: {type(op).__name__}")
        return _check_size(result)

    def _eval_Call(self, node: ast.Call) -> Number:
        if not isinstance(node.func, ast.Name) or node.keywords:
            raise LabComputeError("unsupported_syntax", "only whitelisted function calls are allowed")
        fn = _FUNCTIONS.get(node.func.id)
        if fn is None:
            raise LabComputeError("unsupported_name", f"unknown function: {node.func.id}")
        if len(node.args) > 64:
            raise LabComputeError("bound_exceeded", "too many arguments")
        args = [self.eval(arg) for arg in node.args]
        try:
            result = fn(*args)
        except LabComputeError:
            raise
        except TypeError as exc:
            raise LabComputeError("arity_error", f"{node.func.id}: wrong number or type of arguments") from exc
        except (ValueError, ZeroDivisionError, OverflowError) as exc:
            raise LabComputeError("domain_error", f"{node.func.id}: {exc}") from exc
        if getattr(fn, "inexact", False) or isinstance(result, float):
            self.inexact_ops.append(node.func.id)
        return _check_size(_num(result))


def _annotate_float_sources(tree: ast.AST, source: str) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            segment = ast.get_source_segment(source, node)
            if segment and re.fullmatch(r"[0-9_]*\.?[0-9_]*(?:[eE][+-]?[0-9_]+)?", segment):
                node._source = segment.replace("_", "")  # type: ignore[attr-defined]


def _decimal_string(value: Fraction, digits: int = 30) -> str:
    sign = "-" if value < 0 else ""
    value = abs(value)
    whole, remainder = divmod(value.numerator, value.denominator)
    if remainder == 0:
        return f"{sign}{whole}"
    out = []
    for _ in range(min(digits, MAX_DECIMAL_DIGITS)):
        remainder *= 10
        digit, remainder = divmod(remainder, value.denominator)
        out.append(str(digit))
        if remainder == 0:
            break
    suffix = "" if remainder == 0 else "…"
    return f"{sign}{whole}.{''.join(out)}{suffix}"


def evaluate(expression: str, *, exact: bool = True, caret_is_power: bool = True) -> Dict[str, Any]:
    """Evaluate one arithmetic/statistics expression. Raises LabComputeError."""

    if not isinstance(expression, str):
        raise LabComputeError("malformed", "expression must be a string")
    text = expression.strip()
    if not text:
        raise LabComputeError("malformed", "expression is empty")
    if len(text) > MAX_EXPRESSION_CHARS:
        raise LabComputeError("bound_exceeded", f"expression exceeds {MAX_EXPRESSION_CHARS} characters")
    normalized = text.replace("×", "*").replace("÷", "/").replace("−", "-")
    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError as exc:
        raise LabComputeError("malformed", f"syntax error at column {exc.offset or 0}") from exc
    except (ValueError, RecursionError, MemoryError) as exc:
        raise LabComputeError("malformed", "expression could not be parsed") from exc
    node_count = sum(1 for _ in ast.walk(tree))
    if node_count > MAX_AST_NODES:
        raise LabComputeError("bound_exceeded", "expression is too complex")
    _annotate_float_sources(tree, normalized)
    evaluator = _Evaluator(exact=exact, caret_is_power=caret_is_power)
    try:
        value = evaluator.eval(tree)
    except RecursionError as exc:
        raise LabComputeError("bound_exceeded", "expression nesting too deep") from exc
    if isinstance(value, list):
        raise LabComputeError("type_error", "expression must evaluate to a number, not a list")
    value = _normalize(_check_size(_num(value)))
    exact_result = not isinstance(value, float)
    if isinstance(value, int):
        kind = "integer"
        exact_repr = str(value)
        decimal = exact_repr
        json_value: Any = value if value.bit_length() <= 53 else exact_repr
    elif isinstance(value, Fraction):
        kind = "rational"
        exact_repr = f"{value.numerator}/{value.denominator}"
        decimal = _decimal_string(value)
        json_value = float(value) if abs(value) < 1e300 else decimal
    else:
        kind = "float"
        exact_repr = None
        decimal = repr(value)
        json_value = value
    notes = []
    if caret_is_power and isinstance(_first_op(tree, ast.BitXor), ast.BitXor):
        notes.append("'^' was interpreted as exponentiation")
    if evaluator.inexact_ops:
        notes.append("floating-point used for: " + ", ".join(sorted(set(evaluator.inexact_ops))))
    return {
        "expression": text,
        "value": json_value,
        "exact": exact_result,
        "exact_repr": exact_repr,
        "decimal": decimal,
        "type": kind,
        "method": "ast_whitelist",
        "mode": "exact_rational" if exact else "float",
        "notes": notes,
    }


def _first_op(tree: ast.AST, op_type: type) -> Optional[ast.AST]:
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, op_type):
            return node.op
    return None


def supported_functions() -> List[str]:
    return sorted(_FUNCTIONS)


# ---------------------------------------------------------------------------
# Extraction of calculable spans from a chat message (used by the adapter)
# ---------------------------------------------------------------------------

_FENCED_CALC = re.compile(r"```(?:calc|math)\s*\n(.*?)```", re.S | re.I)
_FUNC_NAMES = "|".join(sorted(_FUNCTIONS, key=len, reverse=True))
_SPAN = re.compile(
    rf"(?:(?:\b(?:{_FUNC_NAMES})\s*\()|\b(?:pi|tau)\b|[\d(])"
    rf"(?:(?:\b(?:{_FUNC_NAMES})\s*\()|\b(?:pi|tau)\b|[\d.+\-*/%^()×÷,\[\] ])*",
    re.I,
)
_HYPHEN_ONLY = re.compile(r"^\d+(?:-\d+)+$")
_PERCENT_OF = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)", re.I)
_NUM = r"-?\d+(?:\.\d+)?"
# "the mean of 4, 8, 15 and 16" -> mean(4, 8, 15, 16)
_STAT_OF = re.compile(
    rf"\b(mean|average|avg|median|mode|sum|total|max(?:imum)?|min(?:imum)?|"
    rf"(?:sample\s+)?standard\s+deviation|std\s*dev|variance)\s+of\s+(?:the\s+)?(?:numbers\s+)?"
    rf"({_NUM}(?:\s*(?:,|and|,\s*and)\s*{_NUM})+)",
    re.I,
)
_STAT_FN = {
    "mean": "mean", "average": "mean", "avg": "mean", "median": "median", "mode": "mode",
    "sum": "sum", "total": "sum", "max": "max", "maximum": "max", "min": "min", "minimum": "min",
    "variance": "variance",
}
# Spoken operators between two calculable terms: "819 plus 112", "x% of y, minus 3".
_WORD_OPS = (
    (re.compile(r"\s*,?\s*\b(?:plus|added to)\b\s*", re.I), " + "),
    (re.compile(r"\s*,?\s*\bminus\b\s*", re.I), " - "),
    (re.compile(r"\s*,?\s*\b(?:times|multiplied by)\b\s*", re.I), " * "),
    (re.compile(r"\s*,?\s*\bdivided by\b\s*", re.I), " / "),
)


def _stat_call(match: "re.Match[str]") -> str:
    word = re.sub(r"\s+", " ", match.group(1).lower()).strip()
    if "deviation" in word or "std" in word:
        fn = "stdev"
    else:
        fn = _STAT_FN.get(word, "mean")
    numbers = re.findall(_NUM, match.group(2))
    return f"{fn}({', '.join(numbers)})"


def _verbal_to_symbols(text: str) -> str:
    """Rewrite spoken arithmetic into symbols so whole requests become one expression."""

    out = _PERCENT_OF.sub(lambda m: f"({m.group(1)}/100*{m.group(2)})", text)
    out = _STAT_OF.sub(_stat_call, out)
    for pattern, symbol in _WORD_OPS:
        out = pattern.sub(symbol, out)
    return out


def extract_expressions(message: str, *, limit: int = 5) -> List[str]:
    """Pull candidate expressions out of free text. Only spans that evaluate are kept."""

    text = str(message or "")
    candidates: List[str] = []
    for block in _FENCED_CALC.findall(text):
        candidates.extend(line.strip() for line in block.splitlines() if line.strip())
    symbolic = _verbal_to_symbols(text)
    sources = [symbolic] if symbolic != text else []
    sources.append(text)
    for match in (m for source in sources for m in _SPAN.finditer(source)):
        span = match.group(0).strip().rstrip(",+-*/%^×÷. ").strip()
        if span.count("(") != span.count(")"):
            continue
        if not re.search(r"[+\-*/%^×÷(]", span[1:] if span else ""):
            continue  # a bare number is not a calculation
        if _HYPHEN_ONLY.match(span):
            continue  # phone numbers, dates, ranges and IDs are not subtractions
        candidates.append(span)
    # Fallback for a bare "x% of y" the span pass could not complete.
    for match in _PERCENT_OF.finditer(text):
        candidates.append(f"{match.group(1)}/100*{match.group(2)}")
    out: List[str] = []
    for candidate in candidates:
        if candidate in out:
            continue
        try:
            evaluate(candidate)
        except LabComputeError:
            continue
        # Skip a fragment of an expression already kept ("17.5/100*2340" inside
        # "(17.5/100*2340) + 112"): it repeats work and clutters the answer.
        squashed = candidate.replace(" ", "").strip("()")
        if any(squashed in kept.replace(" ", "") for kept in out):
            continue
        out.append(candidate)
        if len(out) >= limit:
            break
    return out
