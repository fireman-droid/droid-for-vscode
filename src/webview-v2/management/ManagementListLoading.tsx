const placeholderRows = [0, 1, 2, 3, 4];

function LoadingTitle() {
  return <div className="management-loading-title"><span className="management-loading-line" /><span className="management-loading-line management-loading-detail" /></div>;
}

export function SessionListLoading() {
  return <>{placeholderRows.map(row => <div key={row} className="management-session-row" aria-hidden="true">
    <LoadingTitle /><span className="management-loading-line" /><span className="management-loading-line" /><span />
  </div>)}</>;
}

export function MissionListLoading() {
  return <>{placeholderRows.map(row => <tr key={row} aria-hidden="true">
    <td><LoadingTitle /></td><td><span className="management-loading-line" /></td><td><span className="management-loading-line" /></td>
    <td><span className="management-loading-line" /></td><td><span className="management-loading-line" /></td>
  </tr>)}</>;
}
