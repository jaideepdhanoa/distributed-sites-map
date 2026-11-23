import Wordmark from "./Wordmark";

export default function AppLoading() {
  return (
    <main className="shell nda-open" data-testid="app-loading" aria-busy="true" aria-label="Loading NDAs">
      <header className="bar">
        <div className="top">
          <Wordmark level="p" />
          <span className="paper-btn">NDAs <span className="skeleton nda-skel count" data-testid="nda-count-hold" /></span>
        </div>
      </header>
      <div className="map-stage">
        <aside className="nda-pane" aria-label="NDA queue">
          <div className="layers-bar nda-bar"><span className="skeleton nda-skel wide" /></div>
          <div className="nda-tabs" aria-hidden="true">
            <span className="skeleton nda-skel" />
            <span className="skeleton nda-skel" />
            <span className="skeleton nda-skel" />
            <span className="skeleton nda-skel" />
          </div>
          <ul className="nda-list">
            {[0, 1, 2, 3, 4].map((item) => (
              <li key={item} className="nda-row nda-hold">
                <span className="skeleton nda-skel" />
                <span className="skeleton nda-skel wide" />
                <span className="skeleton nda-skel" />
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
