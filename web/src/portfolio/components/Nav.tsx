import { Link, useLocation } from "react-router-dom";

export default function Nav() {
  const location = useLocation();

  // React Router's own navigation only re-runs ScrollManager's scroll-to-top
  // effect when the location actually changes - clicking one of these while
  // already on "/" with no hash is a no-op navigation, so nothing would
  // otherwise scroll the page back up.
  function scrollToTopIfAlreadyHome() {
    if (location.pathname === "/") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link className="nav-mark" to="/" onClick={scrollToTopIfAlreadyHome}>
          petertran.au
        </Link>
        <ul className="nav-links">
          <li className="nav-home">
            <Link to="/" onClick={scrollToTopIfAlreadyHome}>
              home
            </Link>
          </li>
          <li>
            <Link to="/resume">resume</Link>
          </li>
          <li>
            <Link to="/#query">query</Link>
          </li>
          <li>
            <Link to="/#contact">contact</Link>
          </li>
          <li>
            <a href="/peter-tran-resume.pdf" target="_blank" rel="noreferrer">
              download
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
