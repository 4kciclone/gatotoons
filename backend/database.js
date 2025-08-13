// ~/projeto-manga-v2/backend/database.js (VERSÃO FINAL E CORRIGIDA)
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./mangas.db', (err) => {
  if (err) {
    console.error("Erro ao abrir o banco de dados", err.message);
  } else {
    console.log("Conectado ao banco de dados SQLite.");
  }
});

db.serialize(() => {
  // Tabela OBRAS com a estrutura final (incluindo banner_url)
  db.run(`CREATE TABLE IF NOT EXISTS obras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    sinopse TEXT,
    generos TEXT,
    tags TEXT,
    status TEXT NOT NULL,
    capa_url TEXT NOT NULL,
    banner_url TEXT 
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela 'obras'", err.message);
  });

  // Tabela CAPITULOS
  db.run(`CREATE TABLE IF NOT EXISTS capitulos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obra_id INTEGER NOT NULL,
    numero_capitulo TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (obra_id) REFERENCES obras (id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela 'capitulos'", err.message);
  });

  // Tabela PÁGINAS
  db.run(`CREATE TABLE IF NOT EXISTS paginas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capitulo_id INTEGER NOT NULL,
    numero_pagina INTEGER NOT NULL,
    imagem_url TEXT NOT NULL,
    FOREIGN KEY (capitulo_id) REFERENCES capitulos (id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela 'paginas'", err.message);
  });
});

module.exports = db;