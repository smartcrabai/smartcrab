// PipelineAuthoringTests.swift
// Covers the read-only visualisation path: YAML → PipelineGraph parsing and
// the topological auto-layout that positions coordinate-free pipelines.

import CoreGraphics
@testable import SmartCrab
import XCTest

final class PipelineAuthoringTests: XCTestCase {
    // MARK: - YAML parsing

    /// A linear 3-node pipeline parses into 3 nodes + 2 edges, with input/
    /// hidden/output kinds inferred from topology.
    func test_yamlParse_linearPipeline() {
        let yaml = """
        name: linear
        version: "1.0"
        trigger:
          type: cron
          schedule: "0 9 * * *"
        nodes:
          - id: start
            name: Start
            action:
              type: llm_call
              provider: anthropic
              prompt: "x"
              timeout_secs: 30
            next: middle
          - id: middle
            name: Middle
            action:
              type: http_request
              method: GET
              url_template: "https://x"
            next: end
          - id: end
            name: End
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertEqual(graph.nodes.count, 3)
        XCTAssertEqual(graph.edges.count, 2)
        XCTAssertEqual(graph.node(id: "start")?.kind, .input)
        XCTAssertEqual(graph.node(id: "middle")?.kind, .hidden)
        XCTAssertEqual(graph.node(id: "end")?.kind, .output)
    }

    /// A node with a block-form `next:` list produces one edge per target.
    func test_yamlParse_branchingNextBlock() {
        let yaml = """
        name: branch
        version: "1.0"
        trigger:
          type: discord
        nodes:
          - id: a
            name: A
            next:
              - b
              - c
          - id: b
            name: B
          - id: c
            name: C
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertEqual(graph.nodes.count, 3)
        let fromA = graph.edges.filter { $0.from == "a" }.map(\.to).sorted()
        XCTAssertEqual(fromA, ["b", "c"])
    }

    /// Inline flow-sequence `next: [b, c]` is also recognised.
    func test_yamlParse_inlineNextList() {
        let yaml = """
        name: inline
        version: "1.0"
        trigger:
          type: discord
        nodes:
          - id: a
            name: A
            next: [b, c]
          - id: b
            name: B
          - id: c
            name: C
        """
        let graph = PipelineGraph(yaml: yaml)
        let fromA = graph.edges.filter { $0.from == "a" }.map(\.to).sorted()
        XCTAssertEqual(fromA, ["b", "c"])
    }

    func test_yamlParse_emptyYieldsEmptyGraph() {
        XCTAssertEqual(PipelineGraph(yaml: "name: x\n").nodes.count, 0)
    }

    /// `conditions:` branches produce conditional edges; a default `next:`
    /// after the conditions block is still attributed to the node, not the
    /// last condition.
    func test_yamlParse_conditionsProduceConditionalEdges() {
        let yaml = """
        name: cond
        version: "1.0"
        trigger:
          type: discord
        nodes:
          - id: gate
            name: Gate
            action:
              type: llm_call
              provider: anthropic
              prompt: "x"
              timeout_secs: 30
            conditions:
              - match:
                  type: regex
                  pattern: "ok"
                next: pass
              - match:
                  type: regex
                  pattern: "no"
                next: fail
            next: always
          - id: pass
            name: Pass
          - id: fail
            name: Fail
          - id: always
            name: Always
        """
        let graph = PipelineGraph(yaml: yaml)
        let fromGate = graph.edges.filter { $0.from == "gate" }
        let conditional = fromGate.filter { $0.kind == .conditional }.map(\.to).sorted()
        let normal = fromGate.filter { $0.kind == .normal }.map(\.to)
        XCTAssertEqual(conditional, ["fail", "pass"])
        XCTAssertEqual(normal, ["always"])
    }

    /// Action labels reflect the real provider/method/adapter from YAML, and
    /// chat_send nodes are recognised (not collapsed to `.none`).
    func test_yamlParse_actionDetailsAndChatSend() {
        let yaml = """
        name: actions
        version: "1.0"
        trigger:
          type: discord
        nodes:
          - id: think
            name: Think
            action:
              type: llm_call
              provider: openai
              prompt: "x"
              timeout_secs: 30
            next: fetch
          - id: fetch
            name: Fetch
            action:
              type: http_request
              method: POST
              url_template: "https://x"
            next: reply
          - id: reply
            name: Reply
            action:
              type: chat_send
              adapter: discord
              content_template: "{{think.output}}"
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertEqual(graph.node(id: "think")?.action, .llm(provider: "openai"))
        XCTAssertEqual(graph.node(id: "fetch")?.action, .http(method: "POST"))
        XCTAssertEqual(graph.node(id: "reply")?.action, .chatSend(adapter: "discord"))
    }

    /// The top-level `trigger:` block is captured so the canvas can show the
    /// cron schedule on input nodes.
    func test_yamlParse_cronTrigger() {
        let yaml = """
        name: cron-pipeline
        version: "1.0"
        trigger:
          type: cron
          schedule: "0 9 * * *"
        nodes:
          - id: start
            name: Start
            next: end
          - id: end
            name: End
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertEqual(graph.trigger?.type, "cron")
        XCTAssertEqual(graph.trigger?.schedule, "0 9 * * *")
        XCTAssertEqual(graph.trigger?.label, "Cron: 0 9 * * *")
    }

    /// Discord triggers capture the id list in block form, and list items
    /// under other keys are not misattributed to `triggers`.
    func test_yamlParse_discordTriggerBlockList() {
        let yaml = """
        name: discord-pipeline
        version: "1.0"
        trigger:
          type: discord
          channels:
            - "999"
          triggers:
            - "123"
            - "456"
        nodes:
          - id: start
            name: Start
            next: end
          - id: end
            name: End
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertEqual(graph.trigger?.type, "discord")
        XCTAssertEqual(graph.trigger?.triggers, ["123", "456"])
        XCTAssertEqual(graph.trigger?.label, "Discord (2)")
    }

    /// Discord triggers also parse from an inline flow sequence.
    func test_yamlParse_discordTriggerInlineList() {
        let yaml = """
        name: discord-pipeline
        version: "1.0"
        trigger:
          type: discord
          triggers: ["123", "456"]
        nodes:
          - id: start
            name: Start
            next: end
          - id: end
            name: End
        """
        XCTAssertEqual(PipelineGraph(yaml: yaml).trigger?.triggers, ["123", "456"])
    }

    /// YAML keys are order-free: a `trigger:` block written after `nodes:`
    /// is still captured, and top-level comments don't end the block.
    func test_yamlParse_triggerAfterNodes() {
        let yaml = """
        name: reordered
        version: "1.0"
        nodes:
          - id: start
            name: Start
            next: end
          - id: end
            name: End
        trigger:
        # run every morning
          type: cron
          schedule: "0 9 * * *"
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertEqual(graph.nodes.count, 2)
        XCTAssertEqual(graph.trigger?.label, "Cron: 0 9 * * *")
    }

    /// A pipeline without a trigger block parses with `trigger == nil`, and
    /// node-level `type:` lines never leak into the trigger.
    func test_yamlParse_noTrigger() {
        let yaml = """
        name: no-trigger
        version: "1.0"
        nodes:
          - id: start
            name: Start
            action:
              type: shell_command
              command_template: "echo hi"
        """
        let graph = PipelineGraph(yaml: yaml)
        XCTAssertNil(graph.trigger)
        XCTAssertEqual(graph.node(id: "start")?.action, .shell)
    }

    // MARK: - Auto-layout

    /// Every node gets a position; a linear chain stacks downward by layer.
    func test_autoLayout_assignsIncreasingLayers() throws {
        let graph = PipelineGraph(nodes: [
            .init(id: "a", name: "A", kind: .input, position: .zero),
            .init(id: "b", name: "B", kind: .hidden, position: .zero),
            .init(id: "c", name: "C", kind: .output, position: .zero),
        ], edges: [
            .init(id: "e1", from: "a", to: "b"),
            .init(id: "e2", from: "b", to: "c"),
        ])
        let laid = PipelineAutoLayout.apply(to: graph)
        let ya = try XCTUnwrap(laid.node(id: "a")?.position.y)
        let yb = try XCTUnwrap(laid.node(id: "b")?.position.y)
        let yc = try XCTUnwrap(laid.node(id: "c")?.position.y)
        XCTAssertLessThan(ya, yb)
        XCTAssertLessThan(yb, yc)
    }

    /// Sibling targets of a branch share a layer (same Y) but differ in X.
    func test_autoLayout_siblingsShareLayer() throws {
        let graph = PipelineGraph(nodes: [
            .init(id: "a", name: "A", kind: .input, position: .zero),
            .init(id: "b", name: "B", kind: .output, position: .zero),
            .init(id: "c", name: "C", kind: .output, position: .zero),
        ], edges: [
            .init(id: "e1", from: "a", to: "b"),
            .init(id: "e2", from: "a", to: "c"),
        ])
        let laid = PipelineAutoLayout.apply(to: graph)
        let pb = try XCTUnwrap(laid.node(id: "b")?.position)
        let pc = try XCTUnwrap(laid.node(id: "c")?.position)
        XCTAssertEqual(pb.y, pc.y, accuracy: 0.001)
        XCTAssertNotEqual(pb.x, pc.x)
    }

    /// A loop edge (back-edge) must not crash layout or push the target into
    /// an infinite layer; the cyclic node still gets a finite position.
    func test_autoLayout_handlesLoopEdge() {
        let graph = PipelineGraph(nodes: [
            .init(id: "a", name: "A", kind: .input, position: .zero),
            .init(id: "b", name: "B", kind: .hidden, position: .zero),
        ], edges: [
            .init(id: "e1", from: "a", to: "b"),
            .init(id: "e2", from: "b", to: "a", kind: .loop),
        ])
        let laid = PipelineAutoLayout.apply(to: graph)
        XCTAssertEqual(laid.nodes.count, 2)
        for node in laid.nodes {
            XCTAssertTrue(node.position.y.isFinite)
            XCTAssertTrue(node.position.x.isFinite)
        }
    }

    func test_autoLayout_emptyGraphIsNoop() {
        let laid = PipelineAutoLayout.apply(to: .empty)
        XCTAssertTrue(laid.nodes.isEmpty)
    }
}
