# Python Usage

```python
from agent_prism import Tracer

tracer = Tracer("./agent-prism.db")

@tracer.trace("researcher-agent")
def researcher(query: str) -> str:
    return tracer.tool_call("search", {"query": query}, lambda: "answer")
```

The Python package uses the same SQLite schema as the JavaScript SDK, so the JavaScript dashboard reads Python traces directly.