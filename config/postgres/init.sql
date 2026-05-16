-- Ontology-LSP PostgreSQL Initialization Script
-- Creates database schema for knowledge storage and vector embeddings

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create main schema
CREATE SCHEMA IF NOT EXISTS ontology;
SET search_path TO ontology, public;

-- ================================
-- Core Tables
-- ================================

-- Concepts table: stores all code concepts and their metadata
CREATE TABLE IF NOT EXISTS concepts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL, -- function, class, variable, etc.
    file_path TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    column_start INTEGER NOT NULL,
    column_end INTEGER NOT NULL,
    signature TEXT,
    documentation TEXT,
    language VARCHAR(50) NOT NULL,
    project_id UUID NOT NULL,
    embedding vector(1536), -- OpenAI embeddings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(name, type, file_path, line_start)
);

-- Relationships table: concept-to-concept relationships  
CREATE TABLE IF NOT EXISTS relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    relationship_type VARCHAR(100) NOT NULL, -- uses, extends, implements, calls, etc.
    weight FLOAT DEFAULT 1.0,
    confidence FLOAT DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_concept_id, target_concept_id, relationship_type)
);

-- Patterns table: learned refactoring and code patterns
CREATE TABLE IF NOT EXISTS patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    pattern_type VARCHAR(100) NOT NULL,
    before_template TEXT NOT NULL,
    after_template TEXT NOT NULL,
    conditions JSONB DEFAULT '{}',
    confidence FLOAT DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    usage_count INTEGER DEFAULT 0,
    success_rate FLOAT DEFAULT 0.0,
    language VARCHAR(50),
    tags TEXT[],
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(name, pattern_type, language)
);

-- Pattern applications: track when patterns are applied
CREATE TABLE IF NOT EXISTS pattern_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_id UUID NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    feedback_score INTEGER CHECK (feedback_score >= 1 AND feedback_score <= 5),
    notes TEXT
);

-- Evolution history: track how code evolves over time
CREATE TABLE IF NOT EXISTS evolution_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    change_type VARCHAR(100) NOT NULL, -- created, modified, deleted, moved, renamed
    old_signature TEXT,
    new_signature TEXT,
    diff_content TEXT,
    commit_hash VARCHAR(64),
    author VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Projects table: organize concepts by project
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    path TEXT NOT NULL UNIQUE,
    language VARCHAR(50),
    framework VARCHAR(100),
    version VARCHAR(50),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team knowledge: shared learnings across team members
CREATE TABLE IF NOT EXISTS team_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL,
    knowledge_type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[],
    confidence FLOAT DEFAULT 0.5,
    votes INTEGER DEFAULT 0,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================
-- Indexes for Performance  
-- ================================

-- Concept lookup indexes
CREATE INDEX IF NOT EXISTS idx_concepts_name_type ON concepts(name, type);
CREATE INDEX IF NOT EXISTS idx_concepts_file_path ON concepts(file_path);
CREATE INDEX IF NOT EXISTS idx_concepts_language ON concepts(language);
CREATE INDEX IF NOT EXISTS idx_concepts_project_id ON concepts(project_id);
CREATE INDEX IF NOT EXISTS idx_concepts_embedding ON concepts USING ivfflat (embedding vector_cosine_ops);

-- Relationship indexes
CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_concept_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_concept_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_relationships_confidence ON relationships(confidence DESC);

-- Pattern indexes
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_language ON patterns(language);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_usage_count ON patterns(usage_count DESC);

-- Text search indexes
CREATE INDEX IF NOT EXISTS idx_concepts_name_trgm ON concepts USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patterns_name_trgm ON patterns USING gin(name gin_trgm_ops);

-- Time-based indexes
CREATE INDEX IF NOT EXISTS idx_evolution_history_timestamp ON evolution_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_applications_applied_at ON pattern_applications(applied_at DESC);

-- ================================
-- Functions and Triggers
-- ================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update timestamp triggers
CREATE TRIGGER concepts_update_timestamp 
    BEFORE UPDATE ON concepts 
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER relationships_update_timestamp 
    BEFORE UPDATE ON relationships 
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER patterns_update_timestamp 
    BEFORE UPDATE ON patterns 
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Pattern success rate calculation function
CREATE OR REPLACE FUNCTION update_pattern_success_rate()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE patterns 
    SET success_rate = (
        SELECT COALESCE(
            (SELECT COUNT(*) FROM pattern_applications WHERE pattern_id = NEW.pattern_id AND success = true)::FLOAT / 
            NULLIF((SELECT COUNT(*) FROM pattern_applications WHERE pattern_id = NEW.pattern_id), 0),
            0.0
        )
    ),
    usage_count = (
        SELECT COUNT(*) FROM pattern_applications WHERE pattern_id = NEW.pattern_id
    )
    WHERE id = NEW.pattern_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER pattern_application_stats 
    AFTER INSERT OR UPDATE ON pattern_applications 
    FOR EACH ROW EXECUTE FUNCTION update_pattern_success_rate();

-- Vector similarity search function
CREATE OR REPLACE FUNCTION find_similar_concepts(
    query_embedding vector(1536),
    similarity_threshold float DEFAULT 0.7,
    max_results int DEFAULT 10
) RETURNS TABLE(
    concept_id UUID,
    name VARCHAR(255),
    type VARCHAR(100),
    file_path TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.name,
        c.type,
        c.file_path,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM concepts c
    WHERE c.embedding IS NOT NULL
      AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ language 'plpgsql';

-- ================================
-- Sample Data for Development
-- ================================

-- Insert default project
INSERT INTO projects (id, name, path, language) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Project', '/app/workspace', 'typescript')
ON CONFLICT (path) DO NOTHING;

-- Insert sample patterns for common refactorings
INSERT INTO patterns (name, pattern_type, before_template, after_template, language, description, confidence) VALUES
('Extract Function', 'extract', 
 '// Duplicate code block
 %%duplicated_code%%', 
 'function %%function_name%%() {
   %%duplicated_code%%
 }
 
 // Call function
 %%function_name%%()', 
 'typescript', 
 'Extract repeated code into a reusable function', 
 0.8),
('Convert to Arrow Function', 'modernize',
 'function %%function_name%%(%%params%%) {
   %%body%%
 }',
 'const %%function_name%% = (%%params%%) => {
   %%body%%
 }',
 'typescript',
 'Convert traditional function to arrow function',
 0.7),
('Add Error Handling', 'robustness',
 '%%function_call%%',
 'try {
   %%function_call%%
 } catch (error) {
   console.error("Error in %%function_name%%:", error);
   throw error;
 }',
 'typescript',
 'Add proper error handling to function calls',
 0.9)
ON CONFLICT (name, pattern_type, language) DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA ontology TO ontology;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ontology TO ontology;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ontology TO ontology;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA ontology TO ontology;

-- Set default search path
ALTER DATABASE ontology_lsp SET search_path TO ontology, public;