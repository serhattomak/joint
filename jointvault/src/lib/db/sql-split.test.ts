import { describe, expect, it } from 'vitest';
import { splitSqlStatements, stripCommentLines } from './sql-split';

describe('stripCommentLines', () => {
  it('drops a line that is only a comment', () => {
    // Arrange
    const sql = '-- yorum\nSELECT 1';

    // Act
    const result = stripCommentLines(sql);

    // Assert
    expect(result).toBe('\nSELECT 1');
  });

  it('keeps an inline comment on a statement line', () => {
    // Arrange
    const sql = 'SELECT 1 -- yorum';

    // Act
    const result = stripCommentLines(sql);

    // Assert
    expect(result).toBe('SELECT 1 -- yorum');
  });

  it('keeps indentation of statement lines', () => {
    // Arrange
    const sql = 'SELECT\n  -- girinti korunmalı\n  1';

    // Act
    const result = stripCommentLines(sql);

    // Assert
    expect(result).toBe('SELECT\n\n  1');
  });
});

describe('splitSqlStatements', () => {
  it('splits two statements on the semicolon', () => {
    // Arrange
    const sql = 'CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER)';

    // Act
    const statements = splitSqlStatements(sql);

    // Assert
    expect(statements).toEqual(['CREATE TABLE a (id INTEGER)', 'CREATE TABLE b (id INTEGER)']);
  });

  it('does not split on a semicolon inside a comment line', () => {
    /* Aranjman gerçek olaydan: yorum içindeki ';' parçayı ortadan kesiyordu ve
       initDb patlıyordu. Bu test o hatanın sınıfını korur. */
    const sql = 'CREATE TABLE a (id INTEGER);\n-- burada bir ; var\nCREATE TABLE b (id INTEGER)';

    // Act
    const statements = splitSqlStatements(sql);

    // Assert
    expect(statements).toEqual(['CREATE TABLE a (id INTEGER)', 'CREATE TABLE b (id INTEGER)']);
  });

  it('drops empty statements', () => {
    // Arrange
    const sql = 'SELECT 1;;  ; ';

    // Act
    const statements = splitSqlStatements(sql);

    // Assert
    expect(statements).toEqual(['SELECT 1']);
  });

  it('trims surrounding whitespace from each statement', () => {
    // Arrange
    const sql = '\n  SELECT 1  \n';

    // Act
    const statements = splitSqlStatements(sql);

    // Assert
    expect(statements).toEqual(['SELECT 1']);
  });

  it('returns no statements for comment-only input', () => {
    // Arrange
    const sql = '-- sadece yorum\n-- ikinci satır';

    // Act
    const statements = splitSqlStatements(sql);

    // Assert
    expect(statements).toEqual([]);
  });
});
