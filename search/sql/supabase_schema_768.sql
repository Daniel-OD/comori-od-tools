CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS authors (
  id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, url text
);
CREATE TABLE IF NOT EXISTS books (
  id serial PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, url text,
  author_id int REFERENCES authors(id)
);
CREATE TABLE IF NOT EXISTS volumes (
  id serial PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, url text
);
CREATE TABLE IF NOT EXISTS articles (
  id serial PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  url text UNIQUE NOT NULL,
  title text NOT NULL,
  author_id int REFERENCES authors(id),
  book_id int REFERENCES books(id),
  volume_id int REFERENCES volumes(id),
  position int, total_in_book int,
  category text,
  published_at date,
  text text NOT NULL,                   content_hash text NOT NULL,
  duplicate_of int REFERENCES articles(id),
  keywords text[] DEFAULT '{}',
  phrases text[] DEFAULT '{}',
  themes text[] DEFAULT '{}',
  fetched_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS articles_hash_idx ON articles(content_hash);
CREATE INDEX IF NOT EXISTS articles_author_idx ON articles(author_id);
CREATE INDEX IF NOT EXISTS articles_book_idx ON articles(book_id);
CREATE INDEX IF NOT EXISTS articles_volume_idx ON articles(volume_id);
CREATE TABLE IF NOT EXISTS passages (
  id serial PRIMARY KEY,
  article_id int NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  ord int NOT NULL,
  start_char int NOT NULL, end_char int NOT NULL,     text text NOT NULL,
  text_search text NOT NULL,                          n_words int NOT NULL,
  embedding extensions.vector(768)
);
CREATE INDEX IF NOT EXISTS passages_article_idx ON passages(article_id);
CREATE INDEX IF NOT EXISTS passages_trgm_idx ON passages USING gin (text_search extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS passages_emb_idx ON passages USING hnsw (embedding extensions.vector_cosine_ops);
CREATE TABLE IF NOT EXISTS bible_refs (
  id serial PRIMARY KEY,
  article_id int NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  book text NOT NULL, chapter int NOT NULL, verse_start int NOT NULL, verse_end int NOT NULL,
  ref_text text NOT NULL
);
CREATE INDEX IF NOT EXISTS bible_refs_idx ON bible_refs(book, chapter);
CREATE INDEX IF NOT EXISTS bible_refs_article_idx ON bible_refs(article_id);
ALTER TABLE authors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE books      ENABLE ROW LEVEL SECURITY;
ALTER TABLE volumes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE passages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bible_refs ENABLE ROW LEVEL SECURITY;