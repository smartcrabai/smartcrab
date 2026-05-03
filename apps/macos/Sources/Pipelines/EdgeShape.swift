import SwiftUI

/// Bezier-curve edge shape used by `PipelineEditorView`. Mirrors the React
/// `getBezierPath` defaults (vertical control offset proportional to the
/// distance between endpoints).
public struct EdgeShape: Shape {
    public var from: CGPoint
    public var to: CGPoint

    public init(from: CGPoint, to: CGPoint) {
        self.from = from
        self.to = to
    }

    public func path(in _: CGRect) -> Path {
        var path = Path()
        path.move(to: from)
        let dy = max(40, abs(to.y - from.y) * 0.5)
        let c1 = CGPoint(x: from.x, y: from.y + dy)
        let c2 = CGPoint(x: to.x, y: to.y - dy)
        path.addCurve(to: to, control1: c1, control2: c2)
        return path
    }

    public var animatableData: AnimatablePair<
        AnimatablePair<CGFloat, CGFloat>, AnimatablePair<CGFloat, CGFloat>
    > {
        get {
            AnimatablePair(
                AnimatablePair(from.x, from.y),
                AnimatablePair(to.x, to.y)
            )
        }
        set {
            from = CGPoint(x: newValue.first.first, y: newValue.first.second)
            to = CGPoint(x: newValue.second.first, y: newValue.second.second)
        }
    }
}

/// Self-loop arc for `PipelineGraphEdge.Kind.loop` edges. Ports the React
/// `LoopEdge` curve: a circular arc that exits the source port to the right
/// and returns to it from the left.
public struct LoopEdgeShape: Shape {
    public var origin: CGPoint
    public var radius: CGFloat

    public init(origin: CGPoint, radius: CGFloat = 36) {
        self.origin = origin
        self.radius = radius
    }

    public func path(in _: CGRect) -> Path {
        var path = Path()
        let r = radius
        path.move(to: origin)
        path.addCurve(
            to: CGPoint(x: origin.x + r, y: origin.y + r),
            control1: CGPoint(x: origin.x + r * 2, y: origin.y - r),
            control2: CGPoint(x: origin.x + r * 2 + r, y: origin.y)
        )
        path.addCurve(
            to: origin,
            control1: CGPoint(x: origin.x, y: origin.y + r * 1.5),
            control2: CGPoint(x: origin.x - r, y: origin.y + r)
        )
        return path
    }
}
