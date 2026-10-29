import type { CodeTour } from "../store";
import { escapeHtml, renderMarkdownToHtml } from "../player/markdown";

/** A read-only, self-contained HTML playback document: no extension, server or IPC. */
export function createStandaloneTourHtml(tour: CodeTour): string {
  const steps = tour.steps.map((step, index) => ({
    title: step.title || "Step " + (index + 1),
    descriptionHtml: renderMarkdownToHtml(step.description || ""),
    anchor: step.file || step.uri || step.directory || step.view || "",
    line: step.line
  }));

  // Escape '<' so tour-authored text cannot end the embedded script tag.
  const serialized = JSON.stringify(steps).replace(/</g, "\\u003c");
  const style = [
    "*,*::before,*::after{box-sizing:border-box}",
    "body{margin:0;background:#161b22;color:#e6edf3;font:16px/1.6 system-ui,sans-serif}",
    "header{position:sticky;top:0;padding:16px 24px;border-bottom:1px solid #30363d;background:#161b22}",
    "main{max-width:840px;margin:32px auto;padding:0 24px}",
    "nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
    "nav strong{flex:1 1 240px}",
    "button{padding:7px 14px;background:#303b50;color:#fff;border:1px solid #63728c;border-radius:5px;cursor:pointer}",
    "button:disabled{opacity:.45;cursor:default}",
    "progress{display:block;width:100%;margin-top:12px;accent-color:#59baff}",
    "h1{line-height:1.3}",
    "#anchor{color:#aab8ca;font-family:ui-monospace,monospace;font-size:13px}",
    "a{color:#79c0ff}pre{overflow:auto;padding:14px;background:#0d1117}",
    "img{max-width:100%}table{border-collapse:collapse;display:block;overflow-x:auto}",
    "td,th{border:1px solid #30363d;padding:6px 10px}",
    "#done{padding:24px;border:1px solid #63728c;border-radius:8px}",
    "[hidden]{display:none!important}"
  ].join("");
  const script = [
    "(function(){",
    "const steps=" + serialized + ";",
    "let index=0;",
    "const $=id=>document.getElementById(id);",
    "function show(){",
    "const step=steps[index];",
    "$('title').textContent=step.title;",
    "$('anchor').textContent=step.anchor+(step.line?' : '+step.line:'');",
    "$('description').innerHTML=step.descriptionHtml;",
    "$('position').textContent=(index+1)+' / '+steps.length;",
    "$('progress').value=index+1;",
    "$('previous').disabled=index===0;",
    "$('next').disabled=index===steps.length-1;",
    "$('article').hidden=false;$('done').hidden=true;",
    "}",
    "$('previous').addEventListener('click',()=>{if(index>0){index--;show();}});",
    "$('next').addEventListener('click',()=>{if(index<steps.length-1){index++;show();}});",
    "$('finish').addEventListener('click',()=>{$('article').hidden=true;$('done').hidden=false;});",
    "document.addEventListener('keydown',e=>{",
    "if(e.key==='ArrowLeft'&&index>0){index--;show();}",
    "else if(e.key==='ArrowRight'&&index<steps.length-1){index++;show();}",
    "});",
    "if(steps.length){show();}else{$('article').hidden=true;$('done').hidden=false;}",
    "})();"
  ].join("\n");

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(tour.title) + '</title><style>' + style +
    '</style></head><body><header><nav><strong>' + escapeHtml(tour.title) +
    '</strong><button id="previous">Previous</button>' +
    '<span id="position"></span><button id="next">Next</button>' +
    '<button id="finish">Finish</button></nav>' +
    '<progress id="progress" max="' + steps.length + '" value="1"></progress></header>' +
    '<main><article id="article"><h1 id="title"></h1><p id="anchor"></p>' +
    '<section id="description"></section></article>' +
    '<section id="done" hidden>Tour complete. You can close this window.</section></main>' +
    '<script>' + script + '</script></body></html>';
}
