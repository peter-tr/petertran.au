import { Link, useLocation } from "react-router-dom";

export default function Nav() {
  const location = useLocation();
  // Pantry is its own separate thing (own API, own purpose) - the resume
  // site's nav links (resume/query/contact/download) don't apply there, so
  // it just gets the "petertran.au" home link and nothing else.
  const isPantry = location.pathname.startsWith("/pantry");

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link className="nav-mark" to="/">
          petertran.au
        </Link>
        {!isPantry && (
          <ul className="nav-links">
            <li className="nav-home">
              <Link to="/">home</Link>
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
        )}
      </div>
    </nav>
  );
}
