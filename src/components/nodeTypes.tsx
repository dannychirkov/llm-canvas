import React from "react"
import { useNodes, useEdges } from "reactflow"
import TextNode from "./nodes/TextNode"
import SummarizerNode from "./nodes/SummarizerNode"
import GeminiNode from "./nodes/GeminiNode"
import OpenAINode from "./nodes/OpenAINode"
import OpenRouterNode from "./nodes/OpenRouterNode"
import NanoBananaNode from "./nodes/NanoBananaNode"
import MediaNode from "./nodes/MediaNode"
import MemoryNode from "./nodes/MemoryNode"
import NotesNode from "./nodes/NotesNode"
import TestNode from "./nodes/TestNode"
import { Node, Edge, NodeProps } from "@/types"

interface CanvasNodeActions {
  onNodeUpdate: (id: string, patch: Record<string, unknown>) => void
  runNode: (id: string) => void
  onNodeSelect: (id: string) => void
  onRestore: (id: string) => void
}

export const CanvasNodeActionsContext = React.createContext<CanvasNodeActions | null>(null)

type ActionNodeProps = NodeProps & {
  providerKind?: "openai" | "custom"
  onNodeUpdate: CanvasNodeActions["onNodeUpdate"]
  onRun?: CanvasNodeActions["runNode"]
  onNodeSelect?: CanvasNodeActions["onNodeSelect"]
  onRestore?: CanvasNodeActions["onRestore"]
  allNodes?: Node[]
  allEdges?: Edge[]
}

function actionNode(Component: React.ComponentType<ActionNodeProps>, providerKind?: "custom") {
  return function ActionNode(props: NodeProps) {
    const actions = React.useContext(CanvasNodeActionsContext)
    const nodes = useNodes()
    const edges = useEdges()
    if (!actions) throw new Error("Canvas node actions are unavailable")
    return <Component {...props} providerKind={providerKind} onNodeUpdate={actions.onNodeUpdate} onRun={actions.runNode} onNodeSelect={actions.onNodeSelect} onRestore={actions.onRestore} allNodes={nodes} allEdges={edges} />
  }
}

export const canvasNodeTypes = {
  text: actionNode(TextNode), summarizer: actionNode(SummarizerNode), gemini: actionNode(GeminiNode),
  custom: actionNode(OpenAINode, "custom"), openai: actionNode(OpenAINode), openrouter: actionNode(OpenRouterNode),
  nanobanana: actionNode(NanoBananaNode), media: actionNode(MediaNode), memory: actionNode(MemoryNode),
  notes: actionNode(NotesNode), test: actionNode(TestNode)
}

const withGraph = (render: (props: NodeProps, nodes: Node[], edges: Edge[]) => React.ReactElement) => function LiveGraphNode(props: NodeProps) {
  const nodes = useNodes()
  const edges = useEdges()
  return render(props, nodes, edges)
}
export const createNodeTypes = (
  onNodeUpdate: (id: string, patch: Record<string, unknown>) => void,
  runNode: (id: string) => void,
  onNodeSelect: (id: string) => void,
  onRestore?: (id: string) => void
) => ({
  text: (props: NodeProps) => <TextNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onNodeSelect={onNodeSelect} />,
  summarizer: withGraph((props, nodes, edges) => <SummarizerNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onRun={runNode} onNodeSelect={onNodeSelect} allNodes={nodes} allEdges={edges} onRestore={onRestore} />),
  gemini: withGraph((props, nodes, edges) => <GeminiNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onRun={runNode} onNodeSelect={onNodeSelect} allNodes={nodes} allEdges={edges} onRestore={onRestore} />),
  custom: withGraph((props, nodes, edges) => <OpenAINode {...props} providerKind="custom" onNodeUpdate={onNodeUpdate} onRun={runNode} onNodeSelect={onNodeSelect} allNodes={nodes} allEdges={edges} onRestore={onRestore} />),
  openai: withGraph((props, nodes, edges) => <OpenAINode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onRun={runNode} onNodeSelect={onNodeSelect} allNodes={nodes} allEdges={edges} onRestore={onRestore} />),
  openrouter: withGraph((props, nodes, edges) => <OpenRouterNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onRun={runNode} onNodeSelect={onNodeSelect} allNodes={nodes} allEdges={edges} onRestore={onRestore} />),
  nanobanana: withGraph((props, nodes, edges) => <NanoBananaNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onRun={runNode} onNodeSelect={onNodeSelect} allNodes={nodes} allEdges={edges} onRestore={onRestore} />),
  media: (props: NodeProps) => <MediaNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onNodeSelect={onNodeSelect} />,
  memory: (props: NodeProps) => <MemoryNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onNodeSelect={onNodeSelect} />,
  notes: (props: NodeProps) => <NotesNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onNodeSelect={onNodeSelect} />,
  test: (props: NodeProps) => <TestNode key={`${props.id}-${props.data?.hidden || false}`} {...props} onNodeUpdate={onNodeUpdate} onNodeSelect={onNodeSelect} />,
})
