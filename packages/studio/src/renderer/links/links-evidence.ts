// Which of the three evidence states an edge is in, given what a coverage run
// saw (design/graphical-views.md 4). Its own file because it is the one bit of
// the overlay that is a decision rather than drawing, and the decision has a
// case that is easy to get wrong: with NO run, nothing is faded, because the
// view is complete without evidence and static edges are the feature.
import type { GraphEdge, LinkNeighbour, LinksView } from "../../shared/api.js";

export function edgeEvidence(
  n: Pick<LinkNeighbour, "observed" | "flagged" | "via">,
  evidence: LinksView["evidence"],
): GraphEdge["evidence"] {
  // A disagreement between the two derivations outranks everything: it is the
  // only state that says somebody should look.
  if (n.flagged) return "flagged";
  if (!evidence) return undefined;
  return n.observed ? "observed" : "possible";
}
