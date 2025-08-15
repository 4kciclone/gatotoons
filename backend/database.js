const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

// Carrega as variáveis de ambiente
require('dotenv').config();

const DB_FILE = process.env.DATABASE_FILE || 'mangas.db';

// Cria a conexão com o banco de dados
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error("Erro ao abrir o banco de dados", err.message);
        return;
    }
    console.log("Conectado ao banco de dados SQLite.");
});

// "Promisify" para usar async/await com os métodos do DB
const dbRun = promisify(db.run.bind(db));
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

// Função de inicialização do Banco de Dados
async function initializeDatabase() {
    try {
        // Habilitar chaves estrangeiras para garantir a integridade relacional
        await dbRun("PRAGMA foreign_keys = ON;");

        // SQL para criar todas as tabelas
        const createTablesSQL = `
            -- Tabelas Principais
            CREATE TABLE IF NOT EXISTS obras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                sinopse TEXT,
                status TEXT DEFAULT 'Em Andamento' CHECK(status IN ('Em Andamento', 'Concluído', 'Hiato')),
                capa_url TEXT,
                banner_url TEXT,
                tipo TEXT CHECK(tipo IN ('Mangá', 'Manhwa', 'Manhua', 'Webtoon')),
                titulo_alternativo TEXT,
                is_vip BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS capitulos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                obra_id INTEGER NOT NULL,
                numero_capitulo REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (obra_id) REFERENCES obras (id) ON DELETE CASCADE,
                UNIQUE(obra_id, numero_capitulo)
            );

            CREATE TABLE IF NOT EXISTS paginas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                capitulo_id INTEGER NOT NULL,
                numero_pagina INTEGER NOT NULL,
                imagem_url TEXT NOT NULL,
                FOREIGN KEY (capitulo_id) REFERENCES capitulos (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, -- ID do Google
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                image TEXT,
                role TEXT DEFAULT 'user' CHECK(role IN ('user', 'uploader', 'owner')),
                username TEXT UNIQUE,
                vip_until DATE,
                equipped_titulo_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (equipped_titulo_id) REFERENCES titulos(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS configuracoes (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            
            -- Tabelas de Listas (Gêneros, Tags, Títulos)
            CREATE TABLE IF NOT EXISTS generos ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
            CREATE TABLE IF NOT EXISTS tags ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
            CREATE TABLE IF NOT EXISTS titulos ( 
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                nome TEXT NOT NULL UNIQUE, 
                descricao TEXT 
            );

            -- Tabelas de Relacionamento e Funcionalidades
            CREATE TABLE IF NOT EXISTS obra_generos (
                obra_id INTEGER NOT NULL,
                genero_id INTEGER NOT NULL,
                PRIMARY KEY (obra_id, genero_id),
                FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE,
                FOREIGN KEY (genero_id) REFERENCES generos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS obra_tags (
                obra_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (obra_id, tag_id),
                FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS leituras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                obra_id INTEGER NOT NULL,
                read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_obra_status (
                user_id TEXT NOT NULL,
                obra_id INTEGER NOT NULL,
                status TEXT CHECK(status IN ('Lendo', 'Favorito', 'Planejo Ler', 'Concluído', 'Abandonado')),
                nota INTEGER CHECK(nota >= 1 AND nota <= 10),
                PRIMARY KEY (user_id, obra_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comentarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                obra_id INTEGER, -- Pode ser em uma obra
                capitulo_id INTEGER, -- Ou em um capítulo
                parent_comment_id INTEGER, -- Para respostas
                conteudo TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE,
                FOREIGN KEY (capitulo_id) REFERENCES capitulos(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_comment_id) REFERENCES comentarios(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comentario_likes (
                user_id TEXT NOT NULL,
                comentario_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, comentario_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (comentario_id) REFERENCES comentarios(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comentario_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                comentario_id INTEGER NOT NULL,
                motivo TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (comentario_id) REFERENCES comentarios(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_titulos (
                user_id TEXT NOT NULL,
                titulo_id INTEGER NOT NULL,
                unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, titulo_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (titulo_id) REFERENCES titulos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS bug_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                descricao TEXT NOT NULL,
                url TEXT,
                status TEXT DEFAULT 'Pendente' CHECK(status IN ('Pendente', 'Em Análise', 'Resolvido')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL -- Mantém o report mesmo se o user for deletado
            );
        `;

        // O método 'exec' é bom para rodar múltiplos statements SQL de uma vez
        await promisify(db.exec.bind(db))(createTablesSQL);
        console.log("Tabelas criadas ou já existentes com sucesso.");

        // Populando dados iniciais de forma segura (só insere se não existir)
        const initialGeneros = ['Ação', 'Aventura', 'Comédia', 'Drama', 'Fantasia', 'Sci-Fi', 'Romance', 'Slice of Life', 'Isekai', 'Suspense'];
        for (const genero of initialGeneros) {
            await dbRun('INSERT OR IGNORE INTO generos (nome) VALUES (?)', [genero]);
        }
        console.log("Gêneros iniciais garantidos.");

        const initialTags = ['Protagonista OP', 'Sistema', 'Reencarnação', 'Magia', 'Artes Marciais', 'Vingança'];
        for (const tag of initialTags) {
            await dbRun('INSERT OR IGNORE INTO tags (nome) VALUES (?)', [tag]);
        }
        console.log("Tags iniciais garantidas.");

        const initialTitulos = [
            { nome: 'Pioneiro', descricao: 'Primeiro login no GatoToons.' },
            { nome: 'Leitor Voraz', descricao: 'Leu 100 capítulos.' },
            { nome: 'Crítico', descricao: 'Deixou 10 comentários.' }
        ];
        for (const titulo of initialTitulos) {
            await dbRun('INSERT OR IGNORE INTO titulos (nome, descricao) VALUES (?, ?)', [titulo.nome, titulo.descricao]);
        }
        console.log("Títulos iniciais garantidos.");

        // Inserir configurações padrão
        await dbRun(`INSERT OR IGNORE INTO configuracoes (key, value) VALUES ('VIP_LOCK_HOURS', '72')`);
        console.log("Configurações padrão garantidas.");

    } catch (error) {
        console.error("Erro fatal na inicialização do banco de dados:", error);
        throw error; // Propaga o erro para parar a inicialização do servidor
    }

    return { db, dbRun, dbGet, dbAll };
}

module.exports = { initializeDatabase };