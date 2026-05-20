from agent_prism import Tracer


def test_trace_decorator_round_trips(tmp_path):
    db_path = tmp_path / "agent-prism.db"
    tracer = Tracer(str(db_path))

    @tracer.trace("researcher-agent")
    def researcher(query: str) -> str:
        return tracer.tool_call("search", {"query": query}, lambda: "answer")

    assert researcher("pricing") == "answer"
    row = tracer.storage.connection.execute("SELECT agent_name, status FROM agent_runs LIMIT 1").fetchone()
    assert row["agent_name"] == "researcher-agent"
    assert row["status"] == "success"
    tool_count = tracer.storage.connection.execute("SELECT COUNT(*) AS count FROM tool_calls").fetchone()["count"]
    assert tool_count == 1
    tracer.close()