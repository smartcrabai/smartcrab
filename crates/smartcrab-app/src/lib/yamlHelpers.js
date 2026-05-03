import { parse, stringify } from 'yaml';
export function resolveNodeTypes(nodes) {
    const referenced = new Set();
    for (const node of nodes) {
        if (typeof node.next === 'string')
            referenced.add(node.next);
        else if (Array.isArray(node.next))
            node.next.forEach((id) => referenced.add(id));
        node.conditions?.forEach((c) => referenced.add(c.next));
    }
    const result = {};
    for (const node of nodes) {
        const isRef = referenced.has(node.id);
        const hasRouting = !!node.next || (node.conditions?.length ?? 0) > 0;
        result[node.id] = !isRef ? 'input' : hasRouting ? 'hidden' : 'output';
    }
    return result;
}
export function parsePipelineYaml(yaml) {
    return parse(yaml);
}
export function stringifyPipelineYaml(pipeline) {
    return stringify(pipeline);
}
