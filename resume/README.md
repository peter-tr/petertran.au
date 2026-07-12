# Resume

`resume-<date>.tex` is the source of truth; `peter-tran-resume-<date>.pdf` is
its compiled output. Every edit gets a new dated pair so old versions stay
around for reference - don't overwrite an existing dated file, add a new one.

The live site only ever links to the stable, undated
`web/public/peter-tran-resume.pdf` (from `Resume.tsx`, `Nav.tsx`, and
`Hero.tsx`), which is a plain copy of the latest dated PDF here - this
directory isn't served, so the `.tex` source and older PDFs never need to be
web-accessible.

## Making a new version

1. Copy the most recent `resume-<date>.tex` to a new file named with today's
   date and edit that copy.
2. Compile it with any LaTeX engine, e.g.

   ```
   pdflatex resume-<date>.tex   # or: tectonic resume-<date>.tex
   ```

   If you don't have a LaTeX distribution installed, use
   [tectonic](https://tectonic-typesetting.github.io/) (a self-contained
   single binary, no package manager needed) - macOS: `brew install tectonic`.
   Without Homebrew, download a prebuilt binary from the
   [releases page](https://github.com/tectonic-typesetting/tectonic/releases)
   (`tectonic-<version>-aarch64-apple-darwin.tar.gz` for Apple Silicon,
   `x86_64-apple-darwin` for Intel), `tar xzf` it, and put the extracted
   `tectonic` binary on your `PATH`.
3. Rename the compiled output to `peter-tran-resume-<date>.pdf`.
4. Copy that file over the live site path so the site picks it up:

   ```
   cp peter-tran-resume-<date>.pdf ../web/public/peter-tran-resume.pdf
   ```

Note: `resume-<date>.tex` guards the pdfTeX-only `\pdfgentounicode` primitive
with `\ifdefined`, so it compiles cleanly under both pdflatex and tectonic's
XeTeX-based engine.
