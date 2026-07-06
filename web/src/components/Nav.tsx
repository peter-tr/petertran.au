import { Link } from "react-router-dom";

export default function Nav() {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link className="nav-mark" to="/">
          petertran.au
        </Link>
        <ul className="nav-links">
          <li>
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
      </div>
    </nav>
  );
}
