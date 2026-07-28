import styles from "./TopologyEvidence.module.css";

export type TopologyInspection = {
  idCount: number;
  uniqueIdCount: number;
  duplicateIdCount: number;
  localReferenceCount: number;
  unresolvedReferenceCount: number;
  pathElementCount: number;
  duplicatePathDataCount: number;
  compoundPathCount: number;
  closedSubpathCount: number;
  openSubpathCount: number;
  potentialOpenFilledPathCount: number;
  evenOddFillPathCount: number;
  textElementCount: number;
  useElementCount: number;
  styleElementCount: number;
  symbolElementCount: number;
  clipPathCount: number;
  maskCount: number;
  transformedElementCount: number;
  nonPathShapeCount: number;
};

export type TopologyFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
};

type Props = Readonly<{
  topology: TopologyInspection;
  findings: readonly TopologyFinding[];
}>;

const TOPOLOGY_FINDINGS = new Set([
  "SVG_DUPLICATE_ID",
  "SVG_LOCAL_REFERENCE_UNRESOLVED",
  "SVG_TEXT_NOT_OUTLINED",
  "SVG_DUPLICATE_PATH_DATA",
  "SVG_OPEN_FILLED_SUBPATH",
  "SVG_USE_INSTANCE_PRESENT",
  "SVG_STYLE_BLOCK_PRESENT",
]);

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralForm}`;
}

export default function TopologyEvidence({ topology, findings }: Props) {
  const topologyFindings = findings.filter((finding) => TOPOLOGY_FINDINGS.has(finding.code));
  const errorCount = topologyFindings.filter((finding) => finding.severity === "error").length;
  const warningCount = topologyFindings.filter((finding) => finding.severity === "warning").length;
  const state = errorCount > 0 ? "blocked" : warningCount > 0 ? "review" : "clear";

  return (
    <section className={styles.panel} aria-label="SVG topology and editability evidence">
      <header className={styles.header}>
        <div>
          <small>Topology and editability</small>
          <strong>{state === "blocked" ? "Structural blockers detected" : state === "review" ? "Reviewable editability risks" : "Reference structure is coherent"}</strong>
          <span>These diagnostics inspect document references and geometry organisation. They do not claim that artistic construction is approved.</span>
        </div>
        <span className={`${styles.state} ${styles[state]}`}>{state}</span>
      </header>

      <dl className={styles.grid}>
        <div><dt>References</dt><dd>{plural(topology.localReferenceCount, "reference")}</dd><small>{topology.unresolvedReferenceCount} unresolved · {topology.duplicateIdCount} duplicate IDs</small></div>
        <div><dt>Subpaths</dt><dd>{plural(topology.closedSubpathCount, "closed subpath")}</dd><small>{topology.openSubpathCount} open · {topology.potentialOpenFilledPathCount} potentially filled</small></div>
        <div><dt>Compound geometry</dt><dd>{plural(topology.compoundPathCount, "compound path")}</dd><small>{topology.evenOddFillPathCount} explicit even-odd · {topology.duplicatePathDataCount} duplicates</small></div>
        <div><dt>Indirection</dt><dd>{plural(topology.useElementCount + topology.symbolElementCount, "instance")}</dd><small>{topology.styleElementCount} style blocks · {topology.transformedElementCount} transforms</small></div>
        <div><dt>Editable elements</dt><dd>{plural(topology.pathElementCount, "path")}</dd><small>{topology.nonPathShapeCount} primitive shapes · {topology.textElementCount} text elements</small></div>
        <div><dt>Clipping</dt><dd>{plural(topology.clipPathCount, "clip path")}</dd><small>{topology.maskCount} masks · inspect nested visibility manually</small></div>
      </dl>

      {topologyFindings.length > 0 ? (
        <ul className={styles.findings}>
          {topologyFindings.map((finding) => (
            <li key={`${finding.code}-${finding.message}`}>
              <b>{finding.code}</b>
              <span>{finding.message}</span>
              <small>{finding.severity}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
