-- ─── Criar banco ──────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS helpdesk CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE helpdesk;

-- ─── Usuários ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id        VARCHAR(36)  PRIMARY KEY,
  nome      VARCHAR(150) NOT NULL,
  email     VARCHAR(150) NOT NULL UNIQUE,
  senha     VARCHAR(64)  NOT NULL,
  depto     VARCHAR(100) NOT NULL,
  criado_em DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
);

-- ─── Tickets ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id                VARCHAR(6)   PRIMARY KEY,
  user_id           VARCHAR(36)  NOT NULL,
  nome              VARCHAR(150) NOT NULL,
  email_solicitante VARCHAR(150),
  depto             VARCHAR(100),
  cat               VARCHAR(80)  NOT NULL,
  pri               ENUM('Normal','Alta','Urgente') DEFAULT 'Normal',
  titulo            VARCHAR(255) NOT NULL,
  descricao         TEXT         NOT NULL,
  status            ENUM('Aberto','Em andamento','Resolvido') DEFAULT 'Aberto',
  solucao           TEXT,
  avaliacao         TINYINT,
  criado_em         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_status   (status),
  INDEX idx_pri      (pri),
  INDEX idx_user     (user_id),
  INDEX idx_criado   (criado_em)
);

-- ─── Mensagens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensagens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id  VARCHAR(6)         NOT NULL,
  de         ENUM('TI','Usuario') NOT NULL,
  texto      TEXT               NOT NULL,
  enviado_em DATETIME           DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX idx_ticket (ticket_id)
);

-- ─── Anexos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anexos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id    VARCHAR(6)   NOT NULL,
  nome_original VARCHAR(255) NOT NULL,
  arquivo      VARCHAR(255) NOT NULL,
  tamanho      INT          NOT NULL,
  tipo         VARCHAR(100),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

-- ─── Controle de sequência ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  chave VARCHAR(50)  PRIMARY KEY,
  valor VARCHAR(100) NOT NULL
);
INSERT IGNORE INTO config (chave, valor) VALUES ('next_ticket_id', '1');
