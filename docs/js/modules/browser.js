// patched version with better parsing
import { fetchDoc } from "./fetcher.js";
import { showProgress, hideProgress } from "./progress.js";
import { addBooksSearch, addArticlesSearch } from "./search.js";
import { isBookmarked } from "./bookmarks.js";
import { updateCtxBar } from "./ui.js";
import { renderReaderLoading, renderReaderArticle, renderReaderError } from "./reader.js";

let selAuthor = null;
let selBook = null;
let currentContent = null;
let handlers = { onStateChange: () => {}, onBookmarkChange: () => {} };

function emitState(){ handlers.onStateChange({ selAuthor, selBook, currentContent }); }
export function getBrowserState(){ return { selAuthor, selBook, currentContent }; }

export async function selectArticle(article){
  currentContent = null;
  renderReaderLoading();

  try{
    const doc = await fetchDoc(`/article/${article.slug}`);

    doc.querySelectorAll("nav,header,footer,script,style,img,svg,button").forEach(el=>el.remove());

    const title = doc.querySelector("h1")?.textContent?.trim() || article.title;
    const main = doc.querySelector("main, article, .entry-content") || doc.body;

    let lines = [];

    const blocks = main.querySelectorAll("p, h2, h3, blockquote, li");
    if(blocks.length){
      blocks.forEach(el=>{
        const t = el.textContent.trim();
        if(t.length > 30) lines.push(t);
      });
    } else {
      lines = (main.textContent || "").split("\n").map(l=>l.trim()).filter(l=>l.length>40);
    }

    lines = lines.slice(0, 500);

    if(!lines.length) throw new Error("No content parsed");

    currentContent = {
      slug: article.slug,
      title,
      lines,
      fullText: lines.join("\n"),
      author: selAuthor?.name || "",
      book: selBook?.title || ""
    };

    renderReaderArticle(currentContent, handlers.onBookmarkChange);
  }catch(e){
    console.error("Reader parse error", e);
    renderReaderError();
  }

  updateCtxBar(currentContent, selAuthor);
  emitState();
}
