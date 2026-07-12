# Resume PDF

`peter-tran-resume.pdf` is generated from `resume.tex` - edit the `.tex` and
recompile, don't edit the PDF directly. The filename is linked directly from
`Resume.tsx`, `Nav.tsx`, and `Hero.tsx`, so keep it exact.

Regenerate with any LaTeX engine, e.g.

```
pdflatex resume.tex
```

or, if you don't have a LaTeX distribution installed, with
[tectonic](https://tectonic-typesetting.github.io/) (a self-contained,
single-binary engine):

```
tectonic resume.tex
```

Then copy/rename the output over `peter-tran-resume.pdf`.
