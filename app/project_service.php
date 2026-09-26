<?php
declare(strict_types=1);


/**
 * Return the portable workspace path for this installation.
 * Project records created under an older Hostinger domain may contain an
 * absolute path that is no longer inside the current public_html.
 */
function expected_project_workspace(array $project): string
{
    $uuid = trim((string)($project['uuid'] ?? ''));
    if ($uuid === '' || !preg_match('/^[a-f0-9-]{20,}$/i', $uuid)) {
        throw new RuntimeException('The project UUID is invalid.');
    }
    return PROJECTS_PATH . '/' . $uuid;
}

/**
 * Score a workspace without trusting its database path.
 * A richer active application must always win over the 10-file starter template.
 */
function project_workspace_starter_signatures(string $path): array
{
    $matches = [];
    if (!is_dir($path)) return $matches;
    $needles = [
        'Your Windows application is ready to evolve',
        'Run local check',
        'Nexa starter',
    ];
    try {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
                static function (SplFileInfo $item): bool {
                    $name = $item->getFilename();
                    if ($item->isDir() && in_array($name, ['node_modules','vendor','.git','dist','release','build','coverage','.next'], true)) return false;
                    return !$item->isLink();
                }
            ),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        $checked = 0;
        foreach ($iterator as $file) {
            if (!$file->isFile()) continue;
            $ext = strtolower((string)$file->getExtension());
            if (!in_array($ext, ['html','htm','js','jsx','ts','tsx','vue','svelte'], true)) continue;
            if ((int)$file->getSize() > MAX_EDITOR_BYTES) continue;
            if (++$checked > 250) break;
            $content = (string)@file_get_contents($file->getPathname());
            if ($content === '') continue;
            foreach ($needles as $needle) {
                if (!str_contains($content, $needle)) continue;
                $relative = ltrim(str_replace('\\','/',substr($file->getPathname(), strlen(rtrim($path, '/\\')))), '/');
                $matches[] = ['file'=>$relative,'marker'=>$needle];
            }
        }
    } catch (Throwable) {
        return $matches;
    }
    return $matches;
}

/**
 * Resolve only the files that are actually connected to the active delivery
 * graph. Historical starter files, fixtures, validators and backups may stay
 * in the source tree without being treated as the running application.
 */
function project_workspace_relative_path(string $path): ?string
{
    $path = ltrim(str_replace('\\', '/', trim($path)), '/');
    if ($path === '' || str_contains($path, "\0")) return null;
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') continue;
        if ($part === '..') {
            if (!$parts) return null;
            array_pop($parts);
            continue;
        }
        $parts[] = $part;
    }
    return $parts ? implode('/', $parts) : null;
}

function project_workspace_resolve_relative(string $baseFile, string $relative): ?string
{
    $relative = str_replace('\\', '/', trim($relative));
    if ($relative === '' || preg_match('~^[a-z]+:~i', $relative)) return null;
    $baseDir = trim(str_replace('\\', '/', dirname($baseFile)), './');
    $combined = ($baseDir !== '' ? $baseDir . '/' : '') . $relative;
    return project_workspace_relative_path($combined);
}

function project_workspace_extract_active_electron_paths(string $root): array
{
    $result = ['paths'=>[], 'main'=>'', 'preload'=>'', 'renderers'=>[], 'errors'=>[]];
    $packageFile = rtrim($root, '/\\') . '/package.json';
    if (!is_file($packageFile)) {
        $result['errors'][] = 'package.json is missing.';
        return $result;
    }
    $package = json_decode((string)file_get_contents($packageFile), true);
    if (!is_array($package)) {
        $result['errors'][] = 'package.json is invalid.';
        return $result;
    }
    $main = project_workspace_relative_path((string)($package['main'] ?? 'main.js'));
    if ($main === null) {
        $result['errors'][] = 'The Electron main entry is invalid.';
        return $result;
    }
    $result['main'] = $main;
    $result['paths'][] = 'package.json';
    $result['paths'][] = $main;
    $mainFile = rtrim($root, '/\\') . '/' . $main;
    if (!is_file($mainFile)) {
        $result['errors'][] = 'The Electron main entry is missing.';
        return $result;
    }
    $content = (string)file_get_contents($mainFile);
    $mainDir = trim(str_replace('\\', '/', dirname($main)), './');
    $fromMain = static function(string $relative) use ($mainDir): ?string {
        $combined = ($mainDir !== '' ? $mainDir . '/' : '') . $relative;
        return project_workspace_relative_path($combined);
    };

    $preload = $fromMain('preload.js');
    if (preg_match('/preload\s*:\s*path\.join\s*\(\s*__dirname\s*,\s*([^\)]*)\)/i', $content, $match)) {
        $resolved = function_exists('electron_join_expression_path') ? electron_join_expression_path((string)$match[1]) : null;
        if ($resolved !== null && $resolved !== '') $preload = $fromMain($resolved);
    } elseif (preg_match('/preload\s*:\s*[\'"]([^\'"]+)[\'"]/i', $content, $match)) {
        $preload = $fromMain((string)$match[1]);
    }
    if ($preload !== null) {
        $result['preload'] = $preload;
        $result['paths'][] = $preload;
    }

    $renderers = [];
    if (preg_match_all('/loadFile\s*\(\s*path\.join\s*\(\s*__dirname\s*,\s*([^\)]*)\)/i', $content, $matches)) {
        foreach ($matches[1] as $expression) {
            $relative = function_exists('electron_join_expression_path') ? electron_join_expression_path((string)$expression) : null;
            if ($relative !== null && $relative !== '') {
                $resolved = $fromMain($relative);
                if ($resolved !== null) $renderers[] = $resolved;
            }
        }
    }
    if (preg_match_all('/loadFile\s*\(\s*[\'"]([^\'"]+)[\'"]/i', $content, $matches)) {
        foreach ($matches[1] as $relative) {
            $resolved = $fromMain((string)$relative);
            if ($resolved !== null) $renderers[] = $resolved;
        }
    }
    $renderers = array_values(array_unique($renderers));
    $result['renderers'] = $renderers;
    foreach ($renderers as $renderer) $result['paths'][] = $renderer;

    // Follow only scripts referenced by an active renderer. This catches text
    // rendered from JavaScript without scanning unrelated fixtures or legacy
    // source folders.
    $queue = [];
    foreach ($renderers as $renderer) {
        $rendererFile = rtrim($root, '/\\') . '/' . $renderer;
        if (!is_file($rendererFile) || filesize($rendererFile) > MAX_EDITOR_BYTES) continue;
        $html = (string)file_get_contents($rendererFile);
        if (preg_match_all('~<script\b[^>]*\bsrc=[\'"]([^\'"]+)[\'"][^>]*>~i', $html, $scriptMatches)) {
            foreach ($scriptMatches[1] as $src) {
                $clean = preg_replace('~[?#].*$~', '', (string)$src) ?? (string)$src;
                $resolved = project_workspace_resolve_relative($renderer, $clean);
                if ($resolved !== null) $queue[] = $resolved;
            }
        }
    }
    $visited = [];
    while ($queue && count($visited) < 80) {
        $script = array_shift($queue);
        if (!is_string($script) || isset($visited[$script])) continue;
        $visited[$script] = true;
        $result['paths'][] = $script;
        $full = rtrim($root, '/\\') . '/' . $script;
        if (!is_file($full) || filesize($full) > MAX_EDITOR_BYTES) continue;
        $source = (string)file_get_contents($full);
        $imports = [];
        if (preg_match_all('~(?:import\s+(?:[^;]*?\s+from\s+)?|require\s*\(|import\s*\()[\'"]([^\'"]+)[\'"]~i', $source, $importMatches)) {
            $imports = $importMatches[1];
        }
        foreach ($imports as $import) {
            $import = (string)$import;
            if ($import === '' || !str_starts_with($import, '.')) continue;
            $resolved = project_workspace_resolve_relative($script, $import);
            if ($resolved === null) continue;
            $candidates = [$resolved, $resolved . '.js', $resolved . '.mjs', $resolved . '.cjs', rtrim($resolved, '/') . '/index.js'];
            foreach ($candidates as $candidate) {
                if (is_file(rtrim($root, '/\\') . '/' . $candidate)) {
                    $queue[] = $candidate;
                    break;
                }
            }
        }
    }
    $result['paths'] = array_values(array_unique(array_filter($result['paths'], 'is_string')));
    return $result;
}


/**
 * Resolve an Electron delivery graph from an explicit main file. This is used
 * only to identify a complete generated application that already exists in the
 * workspace but was not connected by package.json.
 */
function project_workspace_electron_graph_from_main(string $root, string $main): array
{
    $result = ['paths'=>[], 'main'=>'', 'preload'=>'', 'renderers'=>[], 'errors'=>[]];
    $main = project_workspace_relative_path($main) ?? '';
    if ($main === '') {
        $result['errors'][] = 'The candidate Electron main entry is invalid.';
        return $result;
    }
    $result['main'] = $main;
    $result['paths'][] = $main;
    $mainFile = rtrim($root, '/\\') . '/' . $main;
    if (!is_file($mainFile)) {
        $result['errors'][] = 'The candidate Electron main entry is missing.';
        return $result;
    }
    if (filesize($mainFile) > MAX_EDITOR_BYTES) {
        $result['errors'][] = 'The candidate Electron main entry exceeds the safe inspection limit.';
        return $result;
    }

    $content = (string)file_get_contents($mainFile);
    if (!preg_match('/\bBrowserWindow\b/', $content)) {
        $result['errors'][] = 'The candidate does not create an Electron BrowserWindow.';
        return $result;
    }
    $mainDir = trim(str_replace('\\', '/', dirname($main)), './');
    $fromMain = static function(string $relative) use ($mainDir): ?string {
        $combined = ($mainDir !== '' ? $mainDir . '/' : '') . $relative;
        return project_workspace_relative_path($combined);
    };

    $preload = $fromMain('preload.js');
    if (preg_match('/preload\s*:\s*path\.join\s*\(\s*__dirname\s*,\s*([^\)]*)\)/i', $content, $match)) {
        $resolved = function_exists('electron_join_expression_path') ? electron_join_expression_path((string)$match[1]) : null;
        if ($resolved !== null && $resolved !== '') $preload = $fromMain($resolved);
    } elseif (preg_match('/preload\s*:\s*[\'\"]([^\'\"]+)[\'\"]/i', $content, $match)) {
        $preload = $fromMain((string)$match[1]);
    }
    if ($preload !== null && is_file(rtrim($root, '/\\') . '/' . $preload)) {
        $result['preload'] = $preload;
        $result['paths'][] = $preload;
    }

    $renderers = [];
    if (preg_match_all('/loadFile\s*\(\s*path\.join\s*\(\s*__dirname\s*,\s*([^\)]*)\)/i', $content, $matches)) {
        foreach ($matches[1] as $expression) {
            $relative = function_exists('electron_join_expression_path') ? electron_join_expression_path((string)$expression) : null;
            if ($relative !== null && $relative !== '') {
                $resolved = $fromMain($relative);
                if ($resolved !== null) $renderers[] = $resolved;
            }
        }
    }
    if (preg_match_all('/loadFile\s*\(\s*[\'\"]([^\'\"]+)[\'\"]/i', $content, $matches)) {
        foreach ($matches[1] as $relative) {
            $resolved = $fromMain((string)$relative);
            if ($resolved !== null) $renderers[] = $resolved;
        }
    }
    $renderers = array_values(array_unique(array_filter($renderers, static fn(string $renderer): bool => is_file(rtrim($root, '/\\') . '/' . $renderer))));
    if (!$renderers) {
        $result['errors'][] = 'The candidate main entry does not load an existing local renderer.';
        return $result;
    }
    $result['renderers'] = $renderers;
    foreach ($renderers as $renderer) $result['paths'][] = $renderer;

    $queue = [];
    foreach ($renderers as $renderer) {
        $rendererFile = rtrim($root, '/\\') . '/' . $renderer;
        if (!is_file($rendererFile) || filesize($rendererFile) > MAX_EDITOR_BYTES) continue;
        $html = (string)file_get_contents($rendererFile);
        if (preg_match_all('~<script\b[^>]*\bsrc=[\'\"]([^\'\"]+)[\'\"][^>]*>~i', $html, $scriptMatches)) {
            foreach ($scriptMatches[1] as $src) {
                $clean = preg_replace('~[?#].*$~', '', (string)$src) ?? (string)$src;
                $resolved = project_workspace_resolve_relative($renderer, $clean);
                if ($resolved !== null) $queue[] = $resolved;
            }
        }
    }
    $visited = [];
    while ($queue && count($visited) < 100) {
        $script = array_shift($queue);
        if (!is_string($script) || isset($visited[$script])) continue;
        $visited[$script] = true;
        $result['paths'][] = $script;
        $full = rtrim($root, '/\\') . '/' . $script;
        if (!is_file($full) || filesize($full) > MAX_EDITOR_BYTES) continue;
        $source = (string)file_get_contents($full);
        if (!preg_match_all('~(?:import\s+(?:[^;]*?\s+from\s+)?|require\s*\(|import\s*\()[\'\"]([^\'\"]+)[\'\"]~i', $source, $importMatches)) continue;
        foreach ($importMatches[1] as $import) {
            $import = (string)$import;
            if ($import === '' || !str_starts_with($import, '.')) continue;
            $resolved = project_workspace_resolve_relative($script, $import);
            if ($resolved === null) continue;
            $candidates = [$resolved, $resolved . '.js', $resolved . '.mjs', $resolved . '.cjs', rtrim($resolved, '/') . '/index.js'];
            foreach ($candidates as $candidate) {
                if (is_file(rtrim($root, '/\\') . '/' . $candidate)) {
                    $queue[] = $candidate;
                    break;
                }
            }
        }
    }
    $result['paths'] = array_values(array_unique(array_filter($result['paths'], 'is_string')));
    return $result;
}

function project_workspace_paths_starter_signatures(string $root, array $paths): array
{
    $needles = [
        'Your Windows application is ready to evolve',
        'Run local check',
        'Nexa starter',
    ];
    $matches = [];
    foreach ($paths as $relative) {
        $relative = project_workspace_relative_path((string)$relative);
        if ($relative === null) continue;
        $full = rtrim($root, '/\\') . '/' . $relative;
        if (!is_file($full) || filesize($full) > MAX_EDITOR_BYTES) continue;
        $content = (string)file_get_contents($full);
        foreach ($needles as $needle) {
            if (str_contains($content, $needle)) $matches[] = ['file'=>$relative,'marker'=>$needle];
        }
    }
    return array_values(array_unique($matches, SORT_REGULAR));
}

/**
 * Find generated Electron applications that are already present in the active
 * workspace but are not referenced by package.json. Only complete, local,
 * non-starter delivery graphs are returned.
 */
function project_workspace_generated_delivery_candidates(array $project): array
{
    $root = (string)$project['workspace_path'];
    if (!is_dir($root) || (string)($project['type'] ?? '') !== 'electron') return [];
    $packageFile = rtrim($root, '/\\') . '/package.json';
    $package = is_file($packageFile) ? json_decode((string)file_get_contents($packageFile), true) : null;
    $currentMain = is_array($package) ? (project_workspace_relative_path((string)($package['main'] ?? 'main.js')) ?? '') : '';

    $mainPaths = [
        'main/main.js', 'main/index.js', 'electron/main.js', 'electron/index.js',
        'desktop/main.js', 'app/main.js', 'src/main.js', 'test-lab/main.js',
    ];
    try {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
                static function (SplFileInfo $item): bool {
                    $name = $item->getFilename();
                    if ($item->isDir() && in_array($name, ['node_modules','vendor','.git','dist','release','build','coverage','.next','storage','backups','artifacts'], true)) return false;
                    return !$item->isLink();
                }
            ),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        $checked = 0;
        foreach ($iterator as $file) {
            if (!$file->isFile()) continue;
            if (++$checked > 500) break;
            $ext = strtolower((string)$file->getExtension());
            if (!in_array($ext, ['js','cjs','mjs'], true) || (int)$file->getSize() > MAX_EDITOR_BYTES) continue;
            $content = (string)@file_get_contents($file->getPathname());
            if (!str_contains($content, 'BrowserWindow') || !str_contains($content, 'loadFile')) continue;
            $relative = ltrim(str_replace('\\','/',substr($file->getPathname(), strlen(rtrim($root, '/\\')))), '/');
            $mainPaths[] = $relative;
        }
    } catch (Throwable) {
        // Fixed candidate paths are still evaluated below.
    }

    $projectName = strtolower(trim((string)($project['name'] ?? '')));
    $candidates = [];
    foreach (array_values(array_unique($mainPaths)) as $main) {
        $main = project_workspace_relative_path($main);
        if ($main === null || $main === $currentMain || !is_file(rtrim($root, '/\\') . '/' . $main)) continue;
        $graph = project_workspace_electron_graph_from_main($root, $main);
        if (!empty($graph['errors']) || empty($graph['renderers'])) continue;
        $starterMatches = project_workspace_paths_starter_signatures($root, $graph['paths']);
        if ($starterMatches) continue;

        $score = 100;
        $preferredScores = [
            'main/main.js'=>90, 'electron/main.js'=>80, 'desktop/main.js'=>75,
            'app/main.js'=>70, 'src/main.js'=>55, 'test-lab/main.js'=>45,
        ];
        $score += $preferredScores[$main] ?? 20;
        if (!empty($graph['preload'])) $score += 25;
        foreach ($graph['renderers'] as $renderer) {
            if (str_starts_with($renderer, 'renderer/')) $score += 70;
            elseif (str_contains($renderer, '/renderer/')) $score += 50;
            elseif (str_starts_with($renderer, 'src/')) $score += 20;
            $rendererFile = rtrim($root, '/\\') . '/' . $renderer;
            if ($projectName !== '' && is_file($rendererFile)) {
                $rendererText = strtolower((string)file_get_contents($rendererFile));
                if (str_contains($rendererText, $projectName)) $score += 15;
            }
        }
        $score += min(30, count($graph['paths']) * 2);
        $candidates[] = ['main'=>$main, 'graph'=>$graph, 'score'=>$score];
    }
    usort($candidates, static fn(array $a,array $b): int => ($b['score'] <=> $a['score']) ?: strcmp((string)$a['main'], (string)$b['main']));
    return $candidates;
}

function project_workspace_delivery_build_patterns(string $root, array $graph): array
{
    $patterns = [];
    foreach (($graph['paths'] ?? []) as $path) {
        $relative = project_workspace_relative_path((string)$path);
        if ($relative === null) continue;
        $patterns[] = $relative;
        $first = explode('/', $relative, 2)[0] ?? '';
        if ($first !== '' && is_dir(rtrim($root, '/\\') . '/' . $first)) $patterns[] = $first . '/**/*';
    }
    foreach (['main','preload','renderer','core','connectors','native-bridge','ai','database','services','assets','src','app'] as $directory) {
        if (is_dir(rtrim($root, '/\\') . '/' . $directory)) $patterns[] = $directory . '/**/*';
    }
    foreach (['package.json','package-lock.json','nexa.project.json'] as $file) {
        if (is_file(rtrim($root, '/\\') . '/' . $file)) $patterns[] = $file;
    }
    return array_values(array_unique($patterns));
}


/**
 * Reconstruct the exact project state through one historical version.
 * Later rollback versions are intentionally excluded.
 */
function reconstruct_project_workspace_through_version(array $project, int $throughVersionId, string $destination): array
{
    if (is_dir($destination)) remove_directory($destination);
    if (!mkdir($destination, 0775, true) && !is_dir($destination)) {
        throw new RuntimeException('Unable to create the historical recovery workspace.');
    }

    $stmt = db()->prepare('SELECT vf.path,vf.action,vf.after_content,vf.after_blob_hash
        FROM version_files vf
        JOIN versions v ON v.id=vf.version_id
        WHERE v.project_id=:project AND v.id<=:through
        ORDER BY v.id ASC,vf.id ASC');
    $stmt->execute([':project'=>(int)$project['id'], ':through'=>$throughVersionId]);
    foreach ($stmt->fetchAll() as $row) {
        try {
            $relative = safe_relative_path((string)$row['path']);
        } catch (Throwable) {
            continue;
        }
        if (preg_match('~(^|/)(storage|database\.sqlite|app\.key)(/|$)~i', $relative)) continue;
        $full = $destination . '/' . $relative;
        if ((string)$row['action'] === 'delete') {
            if (is_file($full)) @unlink($full);
            continue;
        }
        $historicalContent=version_file_after_content($row);
        if ($historicalContent === null) continue;
        @mkdir(dirname($full), 0775, true);
        file_put_contents($full, $historicalContent, LOCK_EX);
    }
    return project_workspace_profile($destination, (string)($project['type'] ?? null));
}

function overlay_project_version_on_workspace(array $project, int $versionId, string $destination): void
{
    $stmt = db()->prepare('SELECT vf.path,vf.action,vf.after_content,vf.after_blob_hash
        FROM version_files vf
        JOIN versions v ON v.id=vf.version_id
        WHERE v.project_id=:project AND v.id=:version
        ORDER BY vf.id ASC');
    $stmt->execute([':project'=>(int)$project['id'], ':version'=>$versionId]);
    foreach ($stmt->fetchAll() as $row) {
        try {
            $relative = safe_relative_path((string)$row['path']);
        } catch (Throwable) {
            continue;
        }
        if (preg_match('~(^|/)(storage|database\.sqlite|app\.key)(/|$)~i', $relative)) continue;
        $full = $destination . '/' . $relative;
        if ((string)$row['action'] === 'delete') {
            if (is_file($full)) @unlink($full);
            continue;
        }
        $historicalContent=version_file_after_content($row);
        if ($historicalContent === null) continue;
        @mkdir(dirname($full), 0775, true);
        file_put_contents($full, $historicalContent, LOCK_EX);
    }
}

/**
 * Return the implementation version produced before an automatic rollback and
 * the later small repair version that passed validation for the same task.
 */
function latest_recoverable_validation_candidate(array $project): ?array
{
    $stmt = db()->prepare("SELECT ts.id AS step_id,ts.task_id,ts.metadata_json
        FROM task_steps ts
        JOIN tasks t ON t.id=ts.task_id
        WHERE t.project_id=:project AND ts.step='validating' AND ts.status='failed'
        ORDER BY ts.id DESC LIMIT 30");
    $stmt->execute([':project'=>(int)$project['id']]);

    foreach ($stmt->fetchAll() as $failure) {
        $metadata = json_decode((string)($failure['metadata_json'] ?? ''), true);
        $failedVersionId = (int)($metadata['failed_version_id'] ?? 0);
        if ($failedVersionId <= 0) continue;

        $versionStmt = db()->prepare('SELECT id,version FROM versions WHERE id=:id AND project_id=:project LIMIT 1');
        $versionStmt->execute([':id'=>$failedVersionId, ':project'=>(int)$project['id']]);
        $failedVersion = $versionStmt->fetch();
        if (!$failedVersion) continue;

        $completedStmt = db()->prepare("SELECT id FROM task_steps
            WHERE task_id=:task AND step='validating' AND status='completed' AND id>:after
            ORDER BY id ASC LIMIT 1");
        $completedStmt->execute([':task'=>(int)$failure['task_id'], ':after'=>(int)$failure['step_id']]);
        $completedStepId = (int)($completedStmt->fetchColumn() ?: 0);
        if ($completedStepId <= 0) continue;

        $repairStmt = db()->prepare("SELECT metadata_json FROM task_steps
            WHERE task_id=:task AND step='editing' AND status='completed'
              AND id>:after AND id<:before
            ORDER BY id DESC LIMIT 1");
        $repairStmt->execute([
            ':task'=>(int)$failure['task_id'],
            ':after'=>(int)$failure['step_id'],
            ':before'=>$completedStepId,
        ]);
        $repairMetadata = json_decode((string)($repairStmt->fetchColumn() ?: ''), true);
        $repairVersionId = (int)($repairMetadata['version_id'] ?? 0);

        return [
            'task_id'=>(int)$failure['task_id'],
            'failure_step_id'=>(int)$failure['step_id'],
            'failed_version_id'=>$failedVersionId,
            'failed_version'=>(string)$failedVersion['version'],
            'repair_version_id'=>$repairVersionId,
            'completed_step_id'=>$completedStepId,
        ];
    }
    return null;
}

function project_changes_from_recovery_workspace(array $project, string $candidateRoot): array
{
    $changes = [];
    $candidateProject = $project;
    $candidateProject['workspace_path'] = $candidateRoot;
    foreach (scan_project_files($candidateProject, false) as $file) {
        $relative = (string)$file['path'];
        if (!$file['text'] || (int)$file['size'] > MAX_EDITOR_BYTES) continue;
        if (preg_match('~(^|/)(storage|database\.sqlite|app\.key)(/|$)~i', $relative)) continue;

        $candidateFile = safe_project_file($candidateProject, $relative, true);
        $content = (string)file_get_contents($candidateFile);
        $currentFile = safe_project_file($project, $relative, false);
        if (is_file($currentFile) && hash_file('sha256', $currentFile) === hash('sha256', $content)) continue;
        $changes[] = [
            'path'=>$relative,
            'action'=>is_file($currentFile) ? 'update' : 'create',
            'content'=>$content,
            'rationale'=>'Restore the complete implementation candidate that was lost by an automatic validation rollback.',
        ];
    }
    return $changes;
}

/**
 * Recover a complete implementation that was generated successfully, rolled
 * back because of one packaging validation error, and then replaced by a tiny
 * repair patch. The implementation and its validated repair are merged into
 * one new reversible project version.
 */
function recover_rolled_back_implementation_delivery(array $project): ?array
{
    if ((string)($project['type'] ?? '') !== 'electron') return null;
    $profile = project_workspace_profile((string)$project['workspace_path'], 'electron');
    if (empty($profile['starter_interface'])) return null;

    $candidateInfo = latest_recoverable_validation_candidate($project);
    if ($candidateInfo === null) return null;

    $candidateRoot = TMP_PATH . '/implementation-recovery-' . (int)$project['id'] . '-' . bin2hex(random_bytes(4));
    try {
        reconstruct_project_workspace_through_version($project, (int)$candidateInfo['failed_version_id'], $candidateRoot);
        if ((int)$candidateInfo['repair_version_id'] > 0) {
            overlay_project_version_on_workspace($project, (int)$candidateInfo['repair_version_id'], $candidateRoot);
        }

        $candidateProfile = project_workspace_profile($candidateRoot, 'electron');
        if (!$candidateProfile['exists'] || $candidateProfile['files'] < 3 || !empty($candidateProfile['starter_interface']) || !empty($candidateProfile['active_graph_errors'])) {
            return null;
        }

        $candidateProject = $project;
        $candidateProject['workspace_path'] = $candidateRoot;
        $validation = validate_project($candidateProject);
        $deliveryIssues = electron_delivery_audit($candidateProject, [], 'Recover rolled-back implementation');
        $blocking = array_values(array_filter(
            array_merge($validation['issues'], $deliveryIssues),
            static fn(array $issue): bool => (string)($issue['severity'] ?? '') === 'error'
        ));
        if ($blocking) return null;

        $changes = project_changes_from_recovery_workspace($project, $candidateRoot);
        if (!$changes) return null;
        if (count($changes) > 100) {
            throw new RuntimeException('The recoverable implementation exceeds the 100-file reversible change limit.');
        }

        $applied = apply_project_changes(
            $project,
            $changes,
            'Recover implementation lost by automatic validation rollback.',
            'Recovered complete implementation and validated repair'
        );

        $updated = require_project((int)$project['id']);
        $finalIntegrity = project_source_integrity($updated);
        $finalValidation = validate_project($updated);
        $finalDelivery = electron_delivery_audit($updated, array_column($changes, 'path'), 'Recover rolled-back implementation');
        $finalBlocking = array_values(array_filter(
            array_merge($finalValidation['issues'], $finalDelivery),
            static fn(array $issue): bool => (string)($issue['severity'] ?? '') === 'error'
        ));
        if (!$finalIntegrity['valid'] || $finalBlocking) {
            rollback_version($updated, (int)$applied['version_id']);
            throw new RuntimeException('The historical implementation was found, but the merged delivery did not pass local integrity checks. Recovery was rolled back.');
        }

        audit('rolled_back_implementation_recovered', 'project', (int)$project['id'], [
            'new_version'=>$applied['version'],
            'failed_version'=>$candidateInfo['failed_version'],
            'failed_version_id'=>$candidateInfo['failed_version_id'],
            'repair_version_id'=>$candidateInfo['repair_version_id'],
            'files'=>array_column($changes, 'path'),
            'active_paths'=>$finalIntegrity['profile']['active_paths'] ?? [],
        ]);

        return [
            'version'=>$applied['version'],
            'version_id'=>$applied['version_id'],
            'candidate'=>$candidateInfo,
            'files'=>array_column($changes, 'path'),
            'integrity'=>$finalIntegrity,
        ];
    } finally {
        if (is_dir($candidateRoot)) remove_directory($candidateRoot);
    }
}

/**
 * Activate an already-generated Electron application when the root package is
 * still pointing at the original starter. This changes only package metadata,
 * is versioned, backed up and rolled back if the resulting graph is invalid.
 */
function activate_generated_electron_delivery(array $project): ?array
{
    $integrity = project_source_integrity($project);
    if ($integrity['valid'] || (string)($project['type'] ?? '') !== 'electron' || empty($integrity['profile']['starter_interface'])) return null;
    $project = $integrity['project'];
    $candidates = project_workspace_generated_delivery_candidates($project);
    if (!$candidates) return null;

    $best = $candidates[0];
    $secondScore = isset($candidates[1]) ? (int)$candidates[1]['score'] : -1000;
    if ((int)$best['score'] < 170 || ((int)$best['score'] - $secondScore) < 20) return null;

    $packageFile = safe_project_file($project, 'package.json', true);
    $package = json_decode((string)file_get_contents($packageFile), true);
    if (!is_array($package)) throw new RuntimeException('The root package.json is invalid and the generated application cannot be activated safely.');
    $package['main'] = (string)$best['main'];
    if (!isset($package['build']) || !is_array($package['build'])) $package['build'] = [];
    if (isset($package['build']['files']) && is_array($package['build']['files'])) {
        $existingFiles = array_values($package['build']['files']);
        $existingStrings = [];
        foreach ($existingFiles as $entry) if (is_string($entry)) $existingStrings[$entry] = true;
        foreach (project_workspace_delivery_build_patterns((string)$project['workspace_path'], (array)$best['graph']) as $pattern) {
            if (isset($existingStrings[$pattern])) continue;
            $existingFiles[] = $pattern;
            $existingStrings[$pattern] = true;
        }
        $package['build']['files'] = $existingFiles;
    }
    $productName = trim((string)($package['build']['productName'] ?? ''));
    if ($productName === '' || stripos($productName, 'starter') !== false) $package['build']['productName'] = (string)$project['name'];

    $content = json_encode($package, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    $applied = apply_project_changes($project, [[
        'path'=>'package.json',
        'action'=>'update',
        'content'=>$content,
        'rationale'=>'Connect the root Electron package to the complete generated application already present in the workspace.',
    ]], 'Activate the generated Electron delivery graph before GitHub Push and Build.', 'Activate generated Electron delivery');

    $updated = require_project((int)$project['id']);
    $final = project_source_integrity($updated);
    if (!$final['valid']) {
        rollback_version($updated, (int)$applied['version_id']);
        throw new RuntimeException('Nexa found a generated Electron application, but activating it did not produce a complete safe delivery graph. The activation was rolled back.');
    }
    audit('generated_electron_delivery_activated','project',(int)$project['id'],[
        'version'=>$applied['version'],
        'main'=>$best['main'],
        'renderers'=>$best['graph']['renderers'] ?? [],
        'preload'=>$best['graph']['preload'] ?? '',
        'candidate_score'=>$best['score'],
    ]);
    return ['version'=>$applied['version'], 'version_id'=>$applied['version_id'], 'candidate'=>$best, 'integrity'=>$final];
}

/**
 * Write operations may perform one deterministic, reversible activation of a
 * generated application. They never bypass a real starter or incomplete tree.
 */
function ensure_project_source_integrity_for_write(array $project): array
{
    $integrity = project_source_integrity($project);
    if ($integrity['valid']) return $integrity;
    if ((string)($project['type'] ?? '') === 'electron' && !empty($integrity['profile']['starter_interface'])) {
        // First recover an implementation that Nexa itself generated and then
        // accidentally removed during automatic validation rollback.
        $historicalRecovery = recover_rolled_back_implementation_delivery($integrity['project']);
        if ($historicalRecovery !== null) {
            $integrity = project_source_integrity(require_project((int)$project['id']));
            $integrity['historical_recovery'] = $historicalRecovery;
            return $integrity;
        }

        // Otherwise activate a complete application that is already present in
        // a separate folder of the active workspace.
        $activation = activate_generated_electron_delivery($integrity['project']);
        if ($activation !== null) {
            $integrity = project_source_integrity(require_project((int)$project['id']));
            $integrity['activation'] = $activation;
            return $integrity;
        }
        $candidates = project_workspace_generated_delivery_candidates($integrity['project']);
        if (!$candidates) {
            $integrity['issues'][] = 'No complete non-starter Electron main/renderer graph was found in the active folder or in the recoverable validation history.';
        } else {
            $integrity['issues'][] = 'More than one generated Electron entry is possible or the candidate is incomplete; Nexa refused to choose one blindly.';
        }
    }
    return $integrity;
}

function project_workspace_active_paths(string $path, ?string $type = null): array
{
    if (!is_dir($path)) return ['paths'=>[], 'errors'=>['Workspace does not exist.'], 'main'=>'', 'preload'=>'', 'renderers'=>[]];
    if ($type === 'electron') return project_workspace_extract_active_electron_paths($path);
    $candidates = match ($type) {
        'php_web' => ['index.php'],
        'pwa' => ['index.html','manifest.webmanifest','sw.js'],
        'android' => ['package.json','www/index.html','src/index.html'],
        default => ['index.html','index.php','package.json','main.js'],
    };
    return ['paths'=>array_values(array_filter($candidates, static fn(string $candidate): bool => is_file(rtrim($path, '/\\') . '/' . $candidate))), 'errors'=>[], 'main'=>'', 'preload'=>'', 'renderers'=>[]];
}

function project_workspace_active_starter_signatures(string $path, ?string $type = null): array
{
    $active = project_workspace_active_paths($path, $type);
    $needles = [
        'Your Windows application is ready to evolve',
        'Run local check',
        'Nexa starter',
    ];
    $matches = [];
    foreach (($active['paths'] ?? []) as $relative) {
        $relative = project_workspace_relative_path((string)$relative);
        if ($relative === null) continue;
        $full = rtrim($path, '/\\') . '/' . $relative;
        if (!is_file($full) || filesize($full) > MAX_EDITOR_BYTES) continue;
        $content = (string)file_get_contents($full);
        foreach ($needles as $needle) {
            if (str_contains($content, $needle)) $matches[] = ['file'=>$relative,'marker'=>$needle];
        }
    }
    return array_values(array_unique($matches, SORT_REGULAR));
}

function project_workspace_profile(string $path, ?string $type = null): array
{
    $profile = [
        'path' => $path,
        'exists' => is_dir($path),
        'files' => 0,
        'bytes' => 0,
        'score' => 0,
        'selection_score' => 0,
        'markers' => [],
        'active_paths' => [],
        'active_graph_errors' => [],
        'starter_interface' => false,
        'starter_matches' => [],
        'inactive_starter_matches' => [],
    ];
    if (!is_dir($path)) return $profile;

    try {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
                static function (SplFileInfo $item): bool {
                    $name = $item->getFilename();
                    if ($item->isDir() && in_array($name, ['node_modules','vendor','.git','dist','release','build','coverage','.next'], true)) return false;
                    return !$item->isLink();
                }
            ),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iterator as $file) {
            if (!$file->isFile()) continue;
            $profile['files']++;
            $profile['bytes'] += max(0, (int)$file->getSize());
            if ($profile['files'] >= MAX_PROJECT_FILES) break;
        }
    } catch (Throwable $e) {
        $profile['read_error']=$e->getMessage();
        return $profile;
    }

    $markers = [
        'package.json' => 20,
        'nexa.project.json' => 15,
        'main.js' => 10,
        'src/index.html' => 10,
        'test-lab/main.js' => 45,
        'test-lab/src/index.html' => 45,
        'test-lab/preload.js' => 20,
        'scripts/validate-delivery.js' => 15,
        '.github/workflows/nexa-windows-build.yml' => 15,
    ];
    $score = $profile['files'] * 2;
    foreach ($markers as $relative => $weight) {
        if (is_file($path . '/' . $relative)) {
            $profile['markers'][] = $relative;
            $score += $weight;
        }
    }
    $allStarterMatches = project_workspace_starter_signatures($path);
    $activeGraph = project_workspace_active_paths($path, $type);
    $activeStarterMatches = project_workspace_active_starter_signatures($path, $type);
    $profile['active_paths'] = $activeGraph['paths'] ?? [];
    $profile['active_graph_errors'] = $activeGraph['errors'] ?? [];
    $profile['starter_matches'] = $activeStarterMatches;
    $profile['starter_interface'] = $activeStarterMatches !== [];
    $profile['inactive_starter_matches'] = array_values(array_filter(
        $allStarterMatches,
        static fn(array $match): bool => !in_array($match, $activeStarterMatches, true)
    ));
    $profile['score'] = $score;
    $profile['selection_score'] = $score;
    return $profile;
}

/**
 * Rebuild a source tree from Nexa's immutable version history.
 * This is used only as a recovery candidate; it never overwrites a richer
 * workspace and never touches database.sqlite, app.key, builds or artifacts.
 */
function reconstruct_project_history_workspace(array $project, string $destination): array
{
    if (is_dir($destination)) remove_directory($destination);
    if (!mkdir($destination, 0775, true) && !is_dir($destination)) {
        throw new RuntimeException('Unable to create the project recovery workspace.');
    }

    $stmt = db()->prepare('SELECT vf.path,vf.action,vf.after_content,vf.after_blob_hash
        FROM version_files vf
        JOIN versions v ON v.id=vf.version_id
        WHERE v.project_id=:project
        ORDER BY v.id ASC,vf.id ASC');
    $stmt->execute([':project'=>(int)$project['id']]);
    foreach ($stmt->fetchAll() as $row) {
        try {
            $relative = safe_relative_path((string)$row['path']);
        } catch (Throwable) {
            continue;
        }
        if (preg_match('~(^|/)(storage|database\.sqlite|app\.key)(/|$)~i', $relative)) continue;
        $full = $destination . '/' . $relative;
        if ((string)$row['action'] === 'delete') {
            if (is_file($full)) @unlink($full);
            continue;
        }
        $historicalContent=version_file_after_content($row);
        if ($historicalContent === null) continue;
        @mkdir(dirname($full), 0775, true);
        file_put_contents($full, $historicalContent, LOCK_EX);
    }
    return project_workspace_profile($destination, (string)($project['type'] ?? null));
}

function project_workspace_selection_score(array $profile, bool $matureProject): int
{
    $score = (int)($profile['score'] ?? 0);
    if (!$matureProject) return $score;
    if (!empty($profile['starter_interface'])) return $score - 1000000;
    if (($profile['files'] ?? 0) >= 3) $score += 100000;
    return $score;
}

/**
 * Migrate legacy absolute workspace paths to the current installation and
 * recover a mature project when the portable folder regressed to the starter.
 */
function normalize_project_workspace(array $project): array
{
    $expected = expected_project_workspace($project);
    $stored = trim((string)($project['workspace_path'] ?? ''));
    $expectedProfile = project_workspace_profile($expected, (string)($project['type'] ?? null));
    $matureProject = (string)($project['current_version'] ?? '1.0.0') !== '1.0.0';
    $needsAudit = $stored === '' || rtrim(str_replace('\\','/',$stored), '/') !== rtrim(str_replace('\\','/',$expected), '/');

    if (!$needsAudit && $matureProject && ($expectedProfile['files'] < 20 || !empty($expectedProfile['starter_interface']))) {
        $needsAudit = true;
    }
    if (!$needsAudit) {
        $project['workspace_path'] = $expected;
        return $project;
    }

    $candidates = [];
    if ($stored !== '') $candidates['stored'] = project_workspace_profile($stored, (string)($project['type'] ?? null));
    $candidates['expected'] = $expectedProfile;

    $recoveryRoot = TMP_PATH . '/workspace-recovery-' . (int)$project['id'] . '-' . bin2hex(random_bytes(4));
    try {
        $candidates['history'] = reconstruct_project_history_workspace($project, $recoveryRoot);
    } catch (Throwable $e) {
        app_log('Workspace history reconstruction failed', ['project_id'=>$project['id'],'error'=>$e->getMessage()]);
        $candidates['history'] = ['path'=>$recoveryRoot,'exists'=>false,'files'=>0,'bytes'=>0,'score'=>0,'selection_score'=>0,'markers'=>[],'starter_interface'=>false,'starter_matches'=>[]];
    }

    foreach ($candidates as $name => $candidate) {
        $candidates[$name]['selection_score'] = project_workspace_selection_score($candidate, $matureProject);
    }
    uasort($candidates, static fn(array $a,array $b): int => (($b['selection_score'] ?? 0) <=> ($a['selection_score'] ?? 0)) ?: (($b['files'] ?? 0) <=> ($a['files'] ?? 0)));
    $sourceName = array_key_first($candidates);
    $source = $candidates[$sourceName];

    if (($source['score'] ?? 0) <= 0 || !is_dir((string)$source['path'])) {
        if (is_dir($recoveryRoot)) remove_directory($recoveryRoot);
        throw new RuntimeException('Nexa could not locate a recoverable source workspace for this project.');
    }

    $expectedCanonical = rtrim(str_replace('\\','/',$expected), '/');
    $sourceCanonical = rtrim(str_replace('\\','/',(string)$source['path']), '/');
    $restored = false;
    $backupPath = '';

    if ($sourceCanonical !== $expectedCanonical) {
        $staging = TMP_PATH . '/workspace-stage-' . (int)$project['id'] . '-' . bin2hex(random_bytes(4));
        copy_directory((string)$source['path'], $staging);

        if (is_dir($expected) && project_workspace_profile($expected, (string)($project['type'] ?? null))['files'] > 0) {
            $backupPath = BACKUPS_PATH . '/' . $project['uuid'] . '/workspace-migration-' . date('Ymd-His');
            copy_directory($expected, $backupPath);
        }
        if (is_dir($expected)) remove_directory($expected);
        if (!mkdir($expected, 0775, true) && !is_dir($expected)) {
            remove_directory($staging);
            throw new RuntimeException('Unable to create the portable project workspace.');
        }
        copy_directory($staging, $expected);
        remove_directory($staging);
        $restored = true;
    }

    if (is_dir($recoveryRoot)) remove_directory($recoveryRoot);

    db()->prepare('UPDATE projects SET workspace_path=:workspace,updated_at=:updated WHERE id=:id')
        ->execute([':workspace'=>$expected,':updated'=>now(),':id'=>$project['id']]);

    audit('project_workspace_normalized','project',(int)$project['id'],[
        'old_path'=>$stored,
        'new_path'=>$expected,
        'selected_source'=>$sourceName,
        'selected_profile'=>$source,
        'candidate_profiles'=>$candidates,
        'backup_path'=>$backupPath,
        'restored'=>$restored,
    ]);
    app_log('Project workspace normalized',[
        'project_id'=>$project['id'],
        'source'=>$sourceName,
        'files'=>$source['files'] ?? 0,
        'starter_interface'=>$source['starter_interface'] ?? false,
        'old_path'=>$stored,
        'new_path'=>$expected,
    ]);

    $project['workspace_path'] = $expected;
    return $project;
}

/**
 * Prevent a starter template or an incomplete recovery folder from being
 * pushed over a mature GitHub repository.
 */
function project_source_integrity(array $project): array
{
    $project = normalize_project_workspace($project);
    $profile = project_workspace_profile((string)$project['workspace_path'], (string)($project['type'] ?? null));
    $issues = [];
    if (!$profile['exists'] || $profile['files'] < 3) {
        $issues[] = 'The project workspace is empty or incomplete.';
    }
    if ((string)($project['type'] ?? '') === 'electron') {
        $packageFile = (string)$project['workspace_path'] . '/package.json';
        if (!is_file($packageFile)) {
            $issues[] = 'package.json is missing.';
        } else {
            $package = json_decode((string)file_get_contents($packageFile), true);
            $main = is_array($package) ? trim((string)($package['main'] ?? 'main.js')) : '';
            if ($main === '' || !is_file((string)$project['workspace_path'] . '/' . str_replace('\\','/',$main))) {
                $issues[] = 'The active Electron main entry is missing.';
            }
        }
    }
    if ((string)($project['type'] ?? '') === 'electron' && !empty($profile['active_graph_errors'])) {
        foreach ($profile['active_graph_errors'] as $graphError) {
            if (!in_array((string)$graphError, $issues, true)) $issues[] = (string)$graphError;
        }
    }
    if ((string)($project['type'] ?? '') === 'electron' && !empty($profile['starter_interface'])) {
        $activeFiles = array_values(array_unique(array_map(static fn(array $match): string => (string)($match['file'] ?? ''), $profile['starter_matches'])));
        $suffix = $activeFiles ? ' Active delivery files: ' . implode(', ', $activeFiles) . '.' : '';
        $issues[]='The Electron entry graph still launches the original Nexa starter interface. Starter or demo shells can be edited, but they cannot be pushed or built as a finished program.' . $suffix;
    }
    return ['valid'=>$issues===[],'issues'=>$issues,'profile'=>$profile,'project'=>$project];
}

function find_project(int $id): ?array
{
    $stmt = db()->prepare('SELECT p.*, u.name AS creator_name FROM projects p LEFT JOIN users u ON u.id=p.created_by WHERE p.id=:id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $project=$stmt->fetch()?:null;
    if (!$project || !user_can_access_project_row($project)) return null;
    return normalize_project_workspace($project);
}

function require_project(int $id): array
{
    $project = find_project($id);
    if (!$project) {
        http_response_code(404);
        exit('Project not found.');
    }
    return $project;
}

function create_project(array $data, ?array $uploadedZip = null): array
{
    $name = trim((string) ($data['name'] ?? ''));
    if ($name === '') throw new InvalidArgumentException('Project name is required.');
    $slug = slugify((string) ($data['slug'] ?? $name));
    $baseSlug = $slug;
    $i = 2;
    $check = db()->prepare('SELECT COUNT(*) FROM projects WHERE slug=:slug');
    while (true) {
        $check->execute([':slug' => $slug]);
        if ((int) $check->fetchColumn() === 0) break;
        $slug = $baseSlug . '-' . $i++;
    }

    $uuid = uuid_v4();
    $workspace = PROJECTS_PATH . '/' . $uuid;
    if (!mkdir($workspace, 0775, true) && !is_dir($workspace)) throw new RuntimeException('Could not create project workspace.');

    $type = in_array(($data['type'] ?? ''), ['electron','android','php_web','pwa','api','service','docker','custom'], true) ? (string) $data['type'] : 'electron';
    $mode = ($data['approval_mode'] ?? 'review') === 'automatic' ? 'automatic' : 'review';
    $maxAttempts = max(1, min(10, (int) ($data['max_attempts'] ?? setting('default_max_attempts', 1))));
    $defaultWorkflow = nexa_build_target(nexa_default_target_for_type($type))['workflow'];

    $stmt = db()->prepare('INSERT INTO projects
        (uuid,name,slug,description,type,status,workspace_path,current_version,build_provider,approval_mode,max_attempts,github_workflow,created_by,created_at,updated_at)
        VALUES (:uuid,:name,:slug,:description,:type,:status,:workspace,:version,:provider,:mode,:attempts,:workflow,:user,:created,:updated)');
    $stmt->execute([
        ':uuid' => $uuid,
        ':name' => $name,
        ':slug' => $slug,
        ':description' => trim((string) ($data['description'] ?? '')),
        ':type' => $type,
        ':status' => 'active',
        ':workspace' => $workspace,
        ':version' => '1.0.0',
        ':provider' => 'github_actions',
        ':mode' => $mode,
        ':attempts' => $maxAttempts,
        ':workflow' => $defaultWorkflow,
        ':user' => current_user()['id'] ?? null,
        ':created' => now(),
        ':updated' => now(),
    ]);
    $projectId = (int) db()->lastInsertId();
    $project = require_project($projectId);

    try {
        if ($uploadedZip && !empty($uploadedZip['tmp_name'])) {
            import_project_zip($project, $uploadedZip);
        } else {
            seed_project_template($project, $type);
        }

        $initialApplicationVersion = '1.0.0';
        $packageFile = $workspace . '/package.json';
        if (is_file($packageFile)) {
            $packageData = json_decode((string)file_get_contents($packageFile), true);
            $candidateVersion = is_array($packageData) ? nexa_application_semver((string)($packageData['version'] ?? '')) : null;
            if ($candidateVersion !== null) $initialApplicationVersion = $candidateVersion;
        }
        $manifest = [
            'name' => $name,
            'slug' => $slug,
            'uuid' => $uuid,
            'type' => $type,
            'version' => $initialApplicationVersion,
            'application_version' => $initialApplicationVersion,
            'workspace_revision' => '1.0.0',
            'managed_by' => 'Nexa App Builder Pro',
            'created_at' => now(),
            'rules' => [
                'modify_only_necessary_files' => true,
                'backup_before_changes' => true,
                'rollback_enabled' => true,
            ],
        ];
        file_put_contents($workspace . '/nexa.project.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);

        create_initial_version($projectId);
        ensure_project_target_rows(require_project($projectId));
        upsert_project_memory($projectId, 'architecture', 'project_overview', json_encode([
            'name' => $name,
            'description' => $data['description'] ?? '',
            'type' => $type,
            'approval_mode' => $mode,
            'build_provider' => 'github_actions',
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), 10);
    } catch (Throwable $e) {
        db()->prepare('DELETE FROM projects WHERE id=:id')->execute([':id'=>$projectId]);
        remove_directory($workspace);
        throw $e;
    }

    audit('project_created', 'project', $projectId, ['name' => $name, 'type' => $type]);
    return require_project($projectId);
}

function seed_project_template(array $project, string $type): void
{
    $workspace = (string) $project['workspace_path'];
    $templateName = match ($type) {
        'electron' => 'electron',
        'android' => 'android',
        'php_web' => 'php_web',
        'pwa' => 'pwa',
        'api' => 'api',
        'service' => 'service',
        'docker' => 'docker',
        default => '',
    };
    $template = $templateName !== '' ? APP_ROOT . '/templates/' . $templateName : '';
    if ($template !== '' && is_dir($template)) {
        copy_directory($template, $workspace);
        return;
    }

    file_put_contents($workspace . '/README.md', '# ' . $project['name'] . "\n\nCustom project created by Nexa App Builder Pro.\n");
}

function import_project_zip(array $project, array $file): void
{
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) throw new RuntimeException('The ZIP upload failed.');
    if ((int) ($file['size'] ?? 0) > MAX_UPLOAD_BYTES) throw new RuntimeException('The ZIP exceeds the 50 MB upload limit.');
    if (strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION)) !== 'zip') throw new InvalidArgumentException('Upload a ZIP file.');
    if (!class_exists('ZipArchive')) throw new RuntimeException('PHP ZipArchive must be enabled to import ZIP projects.');

    $zip = new ZipArchive();
    if ($zip->open((string) $file['tmp_name']) !== true) throw new RuntimeException('Unable to open the ZIP archive.');
    $workspace = (string) $project['workspace_path'];
    $entries = min($zip->numFiles, MAX_PROJECT_FILES);
    for ($i = 0; $i < $entries; $i++) {
        $name = (string) $zip->getNameIndex($i);
        $normalized = str_replace('\\', '/', $name);
        if ($normalized === '' || str_starts_with($normalized, '/') || preg_match('~(^|/)\.\.(/|$)~', $normalized)) continue;
        if (preg_match('~(^|/)(node_modules|vendor|\.git)(/|$)~i', $normalized)) continue;
        $target = $workspace . '/' . $normalized;
        if (str_ends_with($normalized, '/')) {
            @mkdir($target, 0775, true);
            continue;
        }
        @mkdir(dirname($target), 0775, true);
        $stream = $zip->getStream($name);
        if (!$stream) continue;
        $out = fopen($target, 'wb');
        if (!$out) { fclose($stream); continue; }
        stream_copy_to_stream($stream, $out);
        fclose($stream);
        fclose($out);
    }
    $zip->close();
}

function copy_directory(string $source, string $destination): void
{
    if (!is_dir($destination)) mkdir($destination, 0775, true);
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iterator as $item) {
        $relative = substr($item->getPathname(), strlen($source) + 1);
        $target = $destination . '/' . $relative;
        if ($item->isDir()) {
            if (!is_dir($target)) mkdir($target, 0775, true);
        } elseif (!$item->isLink()) {
            @mkdir(dirname($target), 0775, true);
            copy($item->getPathname(), $target);
        }
    }
}

function remove_directory(string $directory): void
{
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink() || $item->isFile()) @unlink($item->getPathname());
        elseif ($item->isDir()) @rmdir($item->getPathname());
    }
    @rmdir($directory);
}

function scan_project_files(array $project, bool $includeContent = false): array
{
    $root = realpath((string) $project['workspace_path']);
    if (!$root || !is_dir($root)) return [];
    $files = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveCallbackFilterIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
            static function (SplFileInfo $current): bool {
                $name = $current->getFilename();
                if ($current->isDir() && in_array($name, ['node_modules','vendor','.git','dist','release','build','.next','coverage'], true)) return false;
                return !$current->isLink();
            }
        ),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    $count = 0;
    foreach ($iterator as $file) {
        if (!$file->isFile()) continue;
        if (++$count > MAX_PROJECT_FILES) break;
        $path = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
        $entry = [
            'path' => $path,
            'size' => $file->getSize(),
            'modified' => date('c', $file->getMTime()),
            'hash' => $file->getSize() <= 10 * 1024 * 1024 ? hash_file('sha256', $file->getPathname()) : null,
            'text' => is_text_file($path),
        ];
        if ($includeContent && $entry['text'] && $file->getSize() <= MAX_EDITOR_BYTES) {
            $entry['content'] = (string) file_get_contents($file->getPathname());
        }
        $files[] = $entry;
    }
    usort($files, static fn($a,$b) => strnatcasecmp($a['path'], $b['path']));
    return $files;
}

function project_statistics(array $project): array
{
    $files = scan_project_files($project);
    $bytes = array_sum(array_column($files, 'size'));
    $languages = [];
    foreach ($files as $file) {
        $ext = strtolower(pathinfo($file['path'], PATHINFO_EXTENSION)) ?: 'other';
        $languages[$ext] = ($languages[$ext] ?? 0) + 1;
    }
    arsort($languages);
    return ['files' => count($files), 'bytes' => $bytes, 'languages' => array_slice($languages, 0, 8, true)];
}

function project_context(array $project, string $prompt = '', array $preferredPaths = [], ?int $byteLimit = null): array
{
    $configuredLimit = max(30000, min(600000, (int) setting('context_limit_bytes', MAX_CONTEXT_BYTES)));
    $limit = $byteLimit === null ? $configuredLimit : max(15000, min($configuredLimit, $byteLimit));
    $manifest = scan_project_files($project);
    $memoryStmt = db()->prepare('SELECT category,memory_key,content,importance FROM ai_memory WHERE project_id=:project ORDER BY importance DESC, updated_at DESC LIMIT 80');
    $memoryStmt->execute([':project' => $project['id']]);
    $memory = $memoryStmt->fetchAll();

    $keywords = array_values(array_filter(preg_split('/[^a-zA-Z0-9_.-]+/', strtolower($prompt)) ?: [], static fn($x) => strlen($x) >= 3));
    $preferredMap = array_flip(array_map(static fn($p) => str_replace('\\','/',(string)$p), $preferredPaths));
    $scored = [];
    foreach ($manifest as $file) {
        if (!$file['text'] || $file['size'] > MAX_EDITOR_BYTES) continue;
        $pathLower = strtolower($file['path']);
        $score = isset($preferredMap[$file['path']]) ? 1000 : 0;
        foreach ($keywords as $kw) if (str_contains($pathLower, $kw)) $score += 20;
        if (preg_match('~(^|/)(package\.json|composer\.json|nexa\.project\.json|readme\.md|database|schema|config|bootstrap|main\.js|index\.php)$~i', $file['path'])) $score += 100;
        if (preg_match('~\.(php|js|ts|json|yml|yaml|html|css|sql)$~i', $file['path'])) $score += 10;
        $score -= min(20, (int) ($file['size'] / 50000));
        $scored[] = [$score, $file];
    }
    usort($scored, static fn($a,$b) => $b[0] <=> $a[0]);

    $contents = [];
    $used = 0;
    foreach ($scored as [, $file]) {
        $full = safe_project_file($project, $file['path'], true);
        $content = (string) file_get_contents($full);
        $cost = strlen($content) + strlen($file['path']) + 80;
        if ($used + $cost > $limit) continue;
        $contents[] = ['path' => $file['path'], 'content' => $content, 'hash' => $file['hash']];
        $used += $cost;
        if ($used >= $limit) break;
    }

    return [
        'project' => [
            'id' => $project['id'], 'name' => $project['name'], 'description' => $project['description'],
            'type' => $project['type'], 'type_label' => nexa_project_type_label((string)$project['type']),
            'version' => $project['current_version'], 'approval_mode' => $project['approval_mode'],
            'build_targets' => array_map(static fn(array $target): array => [
                'key' => $target['target_key'],
                'label' => $target['meta']['label'],
                'enabled' => (bool)$target['enabled'],
                'auto_build' => (bool)$target['auto_build'],
                'workflow' => $target['workflow_file'],
                'outputs' => $target['meta']['outputs'],
            ], project_build_targets($project)),
        ],
        'memory' => $memory,
        'manifest' => $manifest,
        'files' => $contents,
        'context_bytes' => $used,
        'context_limit' => $limit,
    ];
}

/**
 * Build the evidence package used by planning and implementation when a task
 * needs to verify whether modules exist in the active workspace, immutable
 * version history, local backups or the connected GitHub branch.
 *
 * This prevents an approved "inspect first" plan from reaching the
 * implementation stage without the evidence it requested.
 */
function project_engineering_evidence_context(array $project, array $plan = [], int $byteLimit = 180000, bool $allowRemoteGithub = false): array
{
    $byteLimit = max(50000, min(300000, $byteLimit));
    $workspace = (string)($project['workspace_path'] ?? '');
    $profile = project_workspace_profile($workspace, (string)($project['type'] ?? null));
    $integrity = project_source_integrity($project);

    $versionStmt = db()->prepare('SELECT id,version,label,status,files_changed,diff_json,created_at
        FROM versions WHERE project_id=:project ORDER BY id DESC LIMIT 20');
    $versionStmt->execute([':project'=>(int)$project['id']]);
    $versions = [];
    foreach ($versionStmt->fetchAll() as $row) {
        $diff = json_decode((string)($row['diff_json'] ?? ''), true);
        $paths = [];
        foreach (is_array($diff) ? $diff : [] as $item) {
            $path = trim((string)($item['path'] ?? ''));
            if ($path !== '') $paths[] = $path;
        }
        $versions[] = [
            'id'=>(int)$row['id'],
            'version'=>(string)$row['version'],
            'label'=>(string)$row['label'],
            'status'=>(string)$row['status'],
            'files_changed'=>(int)$row['files_changed'],
            'paths'=>array_values(array_unique($paths)),
            'created_at'=>(string)$row['created_at'],
        ];
    }

    $historySampleLimit=max(32768,min(131072,$byteLimit));
    $historyStmt = db()->prepare('SELECT v.id AS version_id,v.version,v.label,v.created_at,
            vf.path,vf.action,vf.after_hash,vf.after_blob_hash,length(vf.after_content) AS after_size,
            CASE WHEN vf.after_content IS NOT NULL AND length(vf.after_content)<=:sample_limit
                 THEN vf.after_content ELSE NULL END AS after_content
        FROM version_files vf
        JOIN versions v ON v.id=vf.version_id
        WHERE v.project_id=:project
        ORDER BY v.id DESC,vf.id DESC
        LIMIT 400');
    $historyStmt->bindValue(':project',(int)$project['id'],PDO::PARAM_INT);
    $historyStmt->bindValue(':sample_limit',$historySampleLimit,PDO::PARAM_INT);
    $historyStmt->execute();

    $inventory = [];
    $samples = [];
    $seen = [];
    $revisionSamples = [];
    $used = 0;
    $preferred = [];
    foreach ((array)($plan['affected_files'] ?? []) as $file) {
        $path = strtolower(trim((string)($file['path'] ?? '')));
        if ($path !== '') $preferred[$path] = true;
    }
    $planText = strtolower(
        (string)($plan['objective'] ?? '') . ' ' .
        implode(' ', array_map('strval', (array)($plan['blockers'] ?? []))) . ' ' .
        implode(' ', array_map('strval', (array)($plan['requirements'] ?? [])))
    );
    $keywords = array_values(array_unique(array_filter(
        preg_split('/[^a-z0-9_.-]+/i', $planText) ?: [],
        static fn(string $word): bool => strlen($word) >= 4
    )));

    foreach ($historyStmt->fetchAll() as $row) {
        $path = str_replace('\\', '/', trim((string)$row['path']));
        if ($path === '' || preg_match('~(^|/)(storage|database\.sqlite|app\.key|\.env|node_modules|vendor)(/|$)~i', $path)) continue;

        $content = $row['after_content'];
        if($content===null&&!empty($row['after_blob_hash'])){try{$blobContent=version_blob_read((string)$row['after_blob_hash']);if($blobContent!==null&&strlen($blobContent)<=$historySampleLimit)$content=$blobContent;}catch(Throwable){}}
        $size = (int)($row['after_size'] ?? ($content === null ? 0 : strlen((string)$content)));
        if (!isset($seen[$path])) {
            $seen[$path] = true;
            $inventory[] = [
                'path'=>$path,
                'latest_version'=>(string)$row['version'],
                'action'=>(string)$row['action'],
                'size'=>$size,
                'hash'=>(string)($row['after_hash'] ?? ''),
            ];
        }

        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $textFile = in_array($ext, ['js','cjs','mjs','ts','tsx','json','html','css','scss','md','txt','yml','yaml','xml','sql','cs','csproj','sln','php'], true);
        $score = isset($preferred[strtolower($path)]) ? 1000 : 0;
        foreach ($keywords as $keyword) {
            if (str_contains(strtolower($path), $keyword)) $score += 20;
        }
        if (preg_match('~(^|/)(package\.json|nexa\.project\.json|main\.js|preload\.js|index\.html|.*workflow.*\.ya?ml)$~i', $path)) $score += 200;

        $sampleCount = (int)($revisionSamples[$path] ?? 0);
        if ($sampleCount < 3 && $textFile && $content !== null && $size > 0 && $size <= MAX_EDITOR_BYTES && ($score > 0 || count($samples) < 25)) {
            $cost = strlen($path) + $size + 160;
            if ($used + $cost <= $byteLimit) {
                $samples[] = [
                    'path'=>$path,
                    'version'=>(string)$row['version'],
                    'label'=>(string)$row['label'],
                    'content'=>(string)$content,
                ];
                $revisionSamples[$path] = $sampleCount + 1;
                $used += $cost;
            }
        }
    }

    $backupInventory = [];
    if (is_dir(BACKUPS_PATH)) {
        $uuid = strtolower((string)($project['uuid'] ?? ''));
        try {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator(BACKUPS_PATH, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            foreach ($iterator as $file) {
                if (!$file->isFile()) continue;
                $relative = str_replace('\\', '/', ltrim(substr($file->getPathname(), strlen(rtrim(BACKUPS_PATH, '/\\'))), '/\\'));
                $lower = strtolower($relative);
                if ($uuid === '' || !str_contains($lower, $uuid)) continue;
                $backupInventory[] = [
                    'path'=>$relative,
                    'size'=>(int)$file->getSize(),
                    'modified_at'=>date('Y-m-d H:i:s', (int)$file->getMTime()),
                ];
                if (count($backupInventory) >= 80) break;
            }
        } catch (Throwable $e) {
            $backupInventory[] = ['error'=>$e->getMessage()];
        }
    }

    $githubEvidence = [
        'checked'=>false,
        'configured'=>false,
        'repository'=>(string)($project['github_owner'] ?? '') . '/' . (string)($project['github_repo'] ?? ''),
        'branch'=>(string)($project['github_branch'] ?? 'main'),
        'error'=>'',
        'remote_fetch_allowed'=>$allowRemoteGithub,
        'remote_fetch_deferred'=>false,
        'deferred_reason'=>'',
    ];
    $needsDeepEvidence = (string)($plan['risk'] ?? '') === 'blocked'
        || !empty($plan['blockers'])
        || str_contains($planText, 'history')
        || str_contains($planText, 'backup')
        || str_contains($planText, 'github')
        || str_contains($planText, 'missing')
        || str_contains($planText, 'recover');

    if ($needsDeepEvidence && !$allowRemoteGithub) {
        $githubEvidence['remote_fetch_deferred'] = true;
        $githubEvidence['deferred_reason'] = 'Remote GitHub inspection is not executed inside a bounded Analyze/Implement worker cycle. Nexa uses the active workspace, retained version history and previously synchronized repository evidence instead.';
    } elseif ($needsDeepEvidence && class_exists('GitHubClient') && function_exists('project_has_github')) {
        try {
            $client = new GitHubClient();
            $githubEvidence['configured'] = $client->configured();
            if ($client->configured() && project_has_github($project)) {
                $owner = trim((string)$project['github_owner']);
                $repo = trim((string)$project['github_repo']);
                $branch = trim((string)$project['github_branch']) ?: 'main';
                $sha = $client->branchHeadSha($owner, $repo, $branch);
                $snapshot = $client->sourceSnapshot($owner, $repo, $sha);
                $githubEvidence['checked'] = true;
                $githubEvidence['commit_sha'] = $sha;
                $githubEvidence['file_count'] = count($snapshot['files'] ?? []);
                $githubEvidence['paths'] = array_slice(array_keys($snapshot['files'] ?? []), 0, 500);

                $temp = TMP_PATH . '/engineering-evidence-' . (int)$project['id'] . '-' . bin2hex(random_bytes(4));
                try {
                    @mkdir($temp, 0775, true);
                    foreach (($snapshot['files'] ?? []) as $path => $item) {
                        $relative = safe_relative_path((string)$path);
                        $full = $temp . '/' . $relative;
                        @mkdir(dirname($full), 0775, true);
                        file_put_contents($full, (string)($item['content'] ?? ''), LOCK_EX);
                    }
                    $remoteProfile = project_workspace_profile($temp, (string)($project['type'] ?? null));
                    $githubEvidence['profile'] = [
                        'files'=>(int)($remoteProfile['files'] ?? 0),
                        'starter_interface'=>(bool)($remoteProfile['starter_interface'] ?? false),
                        'active_paths'=>$remoteProfile['active_paths'] ?? [],
                        'active_graph_errors'=>$remoteProfile['active_graph_errors'] ?? [],
                        'markers'=>$remoteProfile['markers'] ?? [],
                    ];
                } finally {
                    if (is_dir($temp)) remove_directory($temp);
                }
            }
        } catch (Throwable $e) {
            $githubEvidence['checked'] = true;
            $githubEvidence['error'] = $e->getMessage();
        }
    }

    return [
        'active_workspace'=>[
            'path'=>$workspace,
            'files'=>(int)($profile['files'] ?? 0),
            'bytes'=>(int)($profile['bytes'] ?? 0),
            'markers'=>$profile['markers'] ?? [],
            'active_paths'=>$profile['active_paths'] ?? [],
            'active_graph_errors'=>$profile['active_graph_errors'] ?? [],
            'starter_interface'=>(bool)($profile['starter_interface'] ?? false),
            'integrity_valid'=>(bool)($integrity['valid'] ?? false),
            'integrity_issues'=>$integrity['issues'] ?? [],
        ],
        'recent_versions'=>$versions,
        'historical_file_inventory'=>$inventory,
        'historical_file_samples'=>$samples,
        'local_backups'=>$backupInventory,
        'github'=>$githubEvidence,
        'evidence_bytes'=>$used,
        'evidence_limit'=>$byteLimit,
    ];
}

function next_project_version(string $current, string $level = 'patch'): string
{
    $parts = array_map('intval', array_pad(explode('.', $current), 3, 0));
    if ($level === 'major') return ($parts[0] + 1) . '.0.0';
    if ($level === 'minor') return $parts[0] . '.' . ($parts[1] + 1) . '.0';
    return $parts[0] . '.' . $parts[1] . '.' . ($parts[2] + 1);
}

function next_available_project_version(int $projectId, string $current, string $level = 'patch'): string
{
    $candidate = next_project_version($current, $level);
    $stmt = db()->prepare('SELECT 1 FROM versions WHERE project_id=:project AND version=:version LIMIT 1');
    $guard = 0;
    while (true) {
        $stmt->execute([':project'=>$projectId, ':version'=>$candidate]);
        if (!$stmt->fetchColumn()) return $candidate;
        if (++$guard > 10000) throw new RuntimeException('Unable to allocate a unique project revision.');
        // Once the requested boundary has been crossed, continue with patch
        // revisions so rejected/no-progress history remains immutable.
        $candidate = next_project_version($candidate, 'patch');
    }
}

function create_initial_version(int $projectId): int
{
    $project = require_project($projectId);
    $stmt = db()->prepare('INSERT OR IGNORE INTO versions (project_id,version,label,prompt,author_id,status,backup_path,files_changed,diff_json,created_at)
        VALUES (:project,:version,:label,:prompt,:author,:status,:backup,:files,:diff,:created)');
    $files = scan_project_files($project, true);
    $stmt->execute([
        ':project' => $projectId, ':version' => '1.0.0', ':label' => 'Initial project', ':prompt' => 'Initial project creation',
        ':author' => current_user()['id'] ?? null, ':status' => 'stable', ':backup' => '', ':files' => count($files),
        ':diff' => json_encode(array_map(static fn($f) => ['path'=>$f['path'],'action'=>'create'], $files)), ':created' => now(),
    ]);
    $versionId = (int) (db()->lastInsertId() ?: db()->query("SELECT id FROM versions WHERE project_id={$projectId} AND version='1.0.0'")->fetchColumn());
    if ($versionId && (int) db()->query('SELECT COUNT(*) FROM version_files WHERE version_id=' . $versionId)->fetchColumn() === 0) {
        $insert = db()->prepare('INSERT INTO version_files (version_id,path,action,before_hash,after_hash,before_content,after_content,before_blob_hash,after_blob_hash) VALUES (:version,:path,:action,NULL,:after_hash,NULL,NULL,NULL,:after_blob)');
        foreach ($files as $file) {
            $content=$file['content'] ?? null;
            $afterBlob=version_blob_store($content);
            $insert->execute([':version'=>$versionId, ':path'=>$file['path'], ':action'=>'create', ':after_hash'=>$file['hash'], ':after_blob'=>$afterBlob]);
        }
    }
    return $versionId;
}


/**
 * Normalize an application release version. Nexa workspace revisions and
 * customer-facing application versions are separate concepts.
 */
function nexa_application_semver(?string $version): ?string
{
    $version = trim((string)$version);
    return preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/', $version) ? $version : null;
}

function project_application_version_from_changes(array $project, array $changes, string $fallbackVersion): string
{
    foreach ($changes as $change) {
        if (($change['path'] ?? '') !== 'package.json' || ($change['action'] ?? '') === 'delete') continue;
        $decoded = json_decode((string)($change['content'] ?? ''), true);
        $version = is_array($decoded) ? nexa_application_semver((string)($decoded['version'] ?? '')) : null;
        if ($version !== null) return $version;
    }
    $packageFile = safe_project_file($project, 'package.json', false);
    if (is_file($packageFile) && filesize($packageFile) <= MAX_EDITOR_BYTES) {
        $decoded = json_decode((string)file_get_contents($packageFile), true);
        $version = is_array($decoded) ? nexa_application_semver((string)($decoded['version'] ?? '')) : null;
        if ($version !== null) return $version;
    }
    $fallback = nexa_application_semver($fallbackVersion);
    if ($fallback !== null) return $fallback;
    throw new RuntimeException('Unable to resolve the application release version.');
}

function normalized_nexa_project_manifest(array $manifest, string $applicationVersion, string $workspaceRevision): array
{
    $manifest['version'] = $applicationVersion;
    $manifest['application_version'] = $applicationVersion;
    $manifest['workspace_revision'] = $workspaceRevision;
    $manifest['updated_at'] = now();
    return $manifest;
}

/**
 * Repair legacy manifests that stored Nexa's reversible workspace revision in
 * nexa.project.json.version. The repair is versioned and never changes the
 * application release version in package.json.
 */
function ensure_project_application_metadata_consistency(array $project): ?array
{
    $packageFile = safe_project_file($project, 'package.json', false);
    $manifestFile = safe_project_file($project, 'nexa.project.json', false);
    if (!is_file($packageFile) || !is_file($manifestFile)) return null;
    if (filesize($packageFile) > MAX_EDITOR_BYTES || filesize($manifestFile) > MAX_EDITOR_BYTES) {
        throw new RuntimeException('Application metadata files exceed the reversible editor limit.');
    }
    $package = json_decode((string)file_get_contents($packageFile), true);
    $manifest = json_decode((string)file_get_contents($manifestFile), true);
    if (!is_array($package) || !is_array($manifest)) throw new RuntimeException('Application metadata JSON is invalid.');
    $applicationVersion = nexa_application_semver((string)($package['version'] ?? ''));
    if ($applicationVersion === null) throw new RuntimeException('package.json does not contain a valid application version.');
    $manifestVersion = nexa_application_semver((string)($manifest['version'] ?? ''));
    $manifestApplicationVersion = nexa_application_semver((string)($manifest['application_version'] ?? ''));
    if ($manifestVersion === $applicationVersion && $manifestApplicationVersion === $applicationVersion) return null;

    $nextRevision = next_available_project_version((int)$project['id'], (string)$project['current_version']);
    $manifest = normalized_nexa_project_manifest($manifest, $applicationVersion, $nextRevision);
    return apply_project_changes(
        $project,
        [[
            'path'=>'nexa.project.json',
            'action'=>'update',
            'content'=>json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n",
            'rationale'=>'Separate application release version from Nexa workspace revision',
        ]],
        'Nexa application metadata consistency repair',
        'Synchronized application metadata without changing the application release version.'
    );
}

function apply_project_changes(array $project, array $changes, string $prompt, string $summary = '', ?int $taskId = null, int $maxFiles = 100, int $maxFileBytes = MAX_EDITOR_BYTES): array
{
    if (!$changes) throw new InvalidArgumentException('No file changes were supplied.');
    if ($maxFiles < 1 || $maxFiles > MAX_MANUAL_DELIVERY_FILES) $maxFiles = 100;
    if ($maxFileBytes < 1 || $maxFileBytes > MAX_REVERSIBLE_FILE_BYTES) $maxFileBytes = MAX_EDITOR_BYTES;
    if (count($changes) > $maxFiles) throw new RuntimeException('The change set exceeds the ' . $maxFiles . '-file safety limit.');

    $normalized = [];
    foreach ($changes as $change) {
        $path = safe_relative_path((string) ($change['path'] ?? ''));
        $action = strtolower((string) ($change['action'] ?? 'update'));
        if (!in_array($action, ['create','update','delete'], true)) throw new InvalidArgumentException('Unsupported file action: ' . $action);
        if (preg_match('~(^|/)(\.env|app\.key|database\.sqlite|storage)(/|$)~i', $path)) throw new RuntimeException('The AI attempted to modify a protected file: ' . $path);
        if ($action !== 'delete' && !array_key_exists('content', $change)) throw new InvalidArgumentException('Missing content for ' . $path);
        $content = $action === 'delete' ? null : (string) $change['content'];
        if ($content !== null && strlen($content) > $maxFileBytes) throw new RuntimeException('File content exceeds the reversible ' . human_bytes($maxFileBytes) . ' limit: ' . $path);
        $existingFile = safe_project_file($project, $path);
        if (is_file($existingFile) && filesize($existingFile) > $maxFileBytes) {
            throw new RuntimeException('Nexa blocked a change to a file larger than the reversible ' . human_bytes($maxFileBytes) . ' limit: ' . $path);
        }
        $normalized[] = ['path'=>$path,'action'=>$action,'content'=>$content,'rationale'=>(string)($change['rationale'] ?? '')];
    }

    $newVersion = next_available_project_version((int)$project['id'], (string)$project['current_version']);
    $applicationVersion = project_application_version_from_changes($project, $normalized, $newVersion);
    // Preserve package.json.version as the customer-facing application version.
    // Nexa's reversible engineering revision is stored separately.
    $manifestIndex = null;
    foreach ($normalized as $index => $change) {
        if ($change['path'] === 'nexa.project.json' && $change['action'] !== 'delete') { $manifestIndex = $index; break; }
    }
    $manifestContent = null;
    if ($manifestIndex !== null) {
        $manifest = json_decode((string)$normalized[$manifestIndex]['content'], true);
        if (!is_array($manifest)) throw new RuntimeException('nexa.project.json changes must contain valid JSON.');
        $manifest = normalized_nexa_project_manifest($manifest, $applicationVersion, $newVersion);
        $manifestContent = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
        $normalized[$manifestIndex]['content'] = $manifestContent;
    } else {
        $manifestFile = safe_project_file($project, 'nexa.project.json');
        if (is_file($manifestFile)) {
            $manifest = json_decode((string)file_get_contents($manifestFile), true);
            if (!is_array($manifest)) throw new RuntimeException('nexa.project.json is invalid JSON.');
            $manifest = normalized_nexa_project_manifest($manifest, $applicationVersion, $newVersion);
            $manifestContent = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
            $normalized[] = ['path'=>'nexa.project.json','action'=>'update','content'=>$manifestContent,'rationale'=>'Synchronize application version and workspace revision'];
        }
    }
    $backupDir = BACKUPS_PATH . '/' . $project['uuid'] . '/v' . $newVersion . '-' . date('Ymd-His');
    if (!mkdir($backupDir, 0775, true) && !is_dir($backupDir)) throw new RuntimeException('Unable to create version backup.');

    $pdo = db();
    $pdo->beginTransaction();
    $versionId = 0;
    try {
        $stmt = $pdo->prepare('INSERT INTO versions (project_id,version,label,prompt,author_id,status,backup_path,files_changed,diff_json,created_at)
            VALUES (:project,:version,:label,:prompt,:author,:status,:backup,:files,:diff,:created)');
        $stmt->execute([
            ':project'=>$project['id'], ':version'=>$newVersion, ':label'=>$summary ?: 'AI change', ':prompt'=>$prompt,
            ':author'=>current_user()['id'] ?? null, ':status'=>'created', ':backup'=>$backupDir, ':files'=>count($normalized),
            ':diff'=>json_encode(array_map(static fn($c)=>['path'=>$c['path'],'action'=>$c['action'],'rationale'=>$c['rationale']],$normalized), JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE), ':created'=>now(),
        ]);
        $versionId = (int) $pdo->lastInsertId();
        $vf = $pdo->prepare('INSERT INTO version_files (version_id,path,action,before_hash,after_hash,before_content,after_content,before_blob_hash,after_blob_hash)
            VALUES (:version,:path,:action,:before_hash,:after_hash,NULL,NULL,:before_blob,:after_blob)');

        foreach ($normalized as $change) {
            $full = safe_project_file($project, $change['path']);
            $exists = is_file($full);
            $before = $exists && filesize($full) <= $maxFileBytes ? (string) file_get_contents($full) : null;
            $beforeHash = $exists ? hash_file('sha256', $full) : null;
            if ($exists) {
                $backupFile = $backupDir . '/' . $change['path'];
                @mkdir(dirname($backupFile), 0775, true);
                copy($full, $backupFile);
            }

            if ($change['action'] === 'delete') {
                if ($exists && !unlink($full)) throw new RuntimeException('Unable to delete ' . $change['path']);
                $afterHash = null;
                $after = null;
            } else {
                @mkdir(dirname($full), 0775, true);
                $temp = $full . '.nexa-' . bin2hex(random_bytes(4)) . '.tmp';
                if (file_put_contents($temp, $change['content'], LOCK_EX) === false) throw new RuntimeException('Unable to write ' . $change['path']);
                if (!rename($temp, $full)) { @unlink($temp); throw new RuntimeException('Unable to finalize ' . $change['path']); }
                $afterHash = hash_file('sha256', $full);
                $after = $change['content'];
            }
            $beforeBlob=version_blob_store($before);
            $afterBlob=version_blob_store($after);
            $vf->execute([
                ':version'=>$versionId, ':path'=>$change['path'], ':action'=>$change['action'], ':before_hash'=>$beforeHash,
                ':after_hash'=>$afterHash, ':before_blob'=>$beforeBlob, ':after_blob'=>$afterBlob,
            ]);
        }

        $pdo->prepare('UPDATE projects SET current_version=:version, updated_at=:updated WHERE id=:id')
            ->execute([':version'=>$newVersion, ':updated'=>now(), ':id'=>$project['id']]);
        if ($taskId) $pdo->prepare('UPDATE tasks SET changes_json=:changes, updated_at=:updated WHERE id=:id')
            ->execute([':changes'=>json_encode($normalized, JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE), ':updated'=>now(), ':id'=>$taskId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        // Restore files already touched from the backup and delete newly-created files.
        foreach ($normalized as $change) {
            try {
                $full = safe_project_file($project, $change['path']);
                $backupFile = $backupDir . '/' . $change['path'];
                if (is_file($backupFile)) {
                    @mkdir(dirname($full), 0775, true);
                    copy($backupFile, $full);
                } elseif ($change['action'] === 'create' && is_file($full)) {
                    @unlink($full);
                }
            } catch (Throwable) {}
        }
        throw $e;
    }

    audit('project_changes_applied', 'project', (int)$project['id'], ['version'=>$newVersion,'files'=>count($normalized),'task_id'=>$taskId]);
    if ($taskId && function_exists('nexa_engine_mark_candidate_applied_for_task')) {
        nexa_engine_mark_candidate_applied_for_task($taskId, $versionId);
    }
    if(function_exists('storage_run_project_retention')){
        try{storage_run_project_retention((int)$project['id']);}catch(Throwable $cleanupError){app_log('Post-version storage retention failed',['project_id'=>$project['id'],'error'=>$cleanupError->getMessage()]);}
    }
    return ['version_id'=>$versionId,'version'=>$newVersion,'backup_path'=>$backupDir,'changes'=>$normalized];
}


function reject_project_candidate_version(array $project, int $versionId, int $taskId, string $reason): array
{
    $project = require_project((int)$project['id']);
    $stmt = db()->prepare('SELECT * FROM versions WHERE id=:id AND project_id=:project LIMIT 1');
    $stmt->execute([':id'=>$versionId, ':project'=>$project['id']]);
    $version = $stmt->fetch();
    if (!$version) throw new RuntimeException('Candidate version not found for rejection.');
    if ((string)$version['version'] !== (string)$project['current_version']) {
        throw new RuntimeException('A no-progress candidate can only be rejected while it is the current project version.');
    }

    $previousStmt = db()->prepare("SELECT id,version FROM versions WHERE project_id=:project AND id<:id AND status<>'rejected_no_progress' ORDER BY id DESC LIMIT 1");
    $previousStmt->execute([':project'=>$project['id'], ':id'=>$versionId]);
    $previous = $previousStmt->fetch();
    if (!$previous) throw new RuntimeException('The previous project version could not be resolved for candidate rejection.');

    $filesStmt = db()->prepare('SELECT * FROM version_files WHERE version_id=:version ORDER BY id DESC');
    $filesStmt->execute([':version'=>$versionId]);
    $files = $filesStmt->fetchAll();
    if (!$files) throw new RuntimeException('The candidate version has no reversible file history.');

    // Validate every restoration source before touching the workspace.
    foreach ($files as $file) {
        if ((string)$file['action'] !== 'create' && version_file_before_content($file) === null) {
            throw new RuntimeException('Candidate rejection cannot restore ' . (string)$file['path'] . ' because its previous content is unavailable.');
        }
    }

    $touched = [];
    try {
        foreach ($files as $file) {
            $path = (string)$file['path'];
            $full = safe_project_file($project, $path);
            $touched[] = $file;
            if ((string)$file['action'] === 'create') {
                if (is_file($full) && !unlink($full)) throw new RuntimeException('Unable to remove no-progress file ' . $path);
                continue;
            }
            @mkdir(dirname($full), 0775, true);
            $temp = $full . '.nexa-reject-' . bin2hex(random_bytes(4)) . '.tmp';
            $beforeContent=version_file_before_content($file);
            if ($beforeContent===null||file_put_contents($temp, $beforeContent, LOCK_EX) === false) {
                throw new RuntimeException('Unable to restore previous content for ' . $path);
            }
            if (!rename($temp, $full)) {
                @unlink($temp);
                throw new RuntimeException('Unable to finalize restoration for ' . $path);
            }
        }
    } catch (Throwable $e) {
        // Put the candidate back exactly as it was if restoration fails midway.
        foreach (array_reverse($touched) as $file) {
            try {
                $full = safe_project_file($project, (string)$file['path']);
                $afterContent=version_file_after_content($file);
                if ($afterContent === null) {
                    if (is_file($full)) @unlink($full);
                } else {
                    @mkdir(dirname($full), 0775, true);
                    file_put_contents($full, $afterContent, LOCK_EX);
                }
            } catch (Throwable) {}
        }
        throw $e;
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE versions SET status='rejected_no_progress',label=:label WHERE id=:id")
            ->execute([':label'=>'Rejected: no verifiable module progress', ':id'=>$versionId]);
        $pdo->prepare('UPDATE projects SET current_version=:version,updated_at=:updated WHERE id=:project')
            ->execute([':version'=>$previous['version'], ':updated'=>now(), ':project'=>$project['id']]);
        $pdo->prepare('UPDATE tasks SET changes_json=NULL,updated_at=:updated WHERE id=:task')
            ->execute([':updated'=>now(), ':task'=>$taskId]);
        $pdo->prepare("UPDATE task_candidates SET status='rejected_no_progress',diagnostic_json=:diagnostic,updated_at=:updated WHERE task_id=:task AND created_version_id=:version")
            ->execute([
                ':diagnostic'=>json_encode(['reason'=>$reason,'reverted_to'=>$previous['version'],'rejected_at'=>now()], JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE),
                ':updated'=>now(), ':task'=>$taskId, ':version'=>$versionId,
            ]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        // Database failure after a successful file restore is an external/manual
        // reconciliation condition; never create another version automatically.
        throw new RuntimeException('The workspace was restored, but candidate state reconciliation failed: ' . $e->getMessage(), 0, $e);
    }

    audit('project_candidate_rejected_no_progress', 'project', (int)$project['id'], [
        'task_id'=>$taskId, 'rejected_version'=>$version['version'], 'restored_version'=>$previous['version'], 'reason'=>$reason,
    ]);
    return [
        'rejected_version_id'=>$versionId,
        'rejected_version'=>(string)$version['version'],
        'restored_version_id'=>(int)$previous['id'],
        'restored_version'=>(string)$previous['version'],
        'reason'=>$reason,
    ];
}

function save_manual_file(array $project, string $path, string $content, string $message = 'Manual editor update'): array
{
    $full = safe_project_file($project, $path);
    if (is_file($full) && !is_text_file($path)) {
        throw new RuntimeException('Binary files cannot be edited in the Nexa text editor.');
    }
    $action = is_file($full) ? 'update' : 'create';
    return apply_project_changes($project, [['path'=>$path,'action'=>$action,'content'=>$content,'rationale'=>'Manual editor save']], $message, $message);
}

function rollback_version(array $project, int $versionId): array
{
    $stmt = db()->prepare('SELECT * FROM versions WHERE id=:id AND project_id=:project LIMIT 1');
    $stmt->execute([':id'=>$versionId, ':project'=>$project['id']]);
    $version = $stmt->fetch();
    if (!$version) throw new RuntimeException('Version not found.');
    if ((string)$version['version'] === '1.0.0') throw new RuntimeException('The initial baseline cannot be undone.');
    if ((string)$version['version'] !== (string)$project['current_version']) {
        throw new RuntimeException('For safety, only the current project version can be undone. Newer changes must be rolled back first.');
    }
    $stmt = db()->prepare('SELECT * FROM version_files WHERE version_id=:version ORDER BY id DESC');
    $stmt->execute([':version'=>$versionId]);
    $changes = [];
    foreach ($stmt->fetchAll() as $file) {
        if ($file['action'] === 'create') {
            $changes[] = ['path'=>$file['path'],'action'=>'delete','rationale'=>'Rollback created file'];
        } else {
            $beforeContent=version_file_before_content($file);
            if($beforeContent!==null)$changes[] = ['path'=>$file['path'],'action'=>is_file(safe_project_file($project,$file['path']))?'update':'create','content'=>$beforeContent,'rationale'=>'Restore previous content'];
        }
    }
    if (!$changes) throw new RuntimeException('This version has no reversible text-file changes.');
    return apply_project_changes($project, $changes, 'Rollback version ' . $version['version'], 'Rollback of v' . $version['version'], null, MAX_MANUAL_DELIVERY_FILES, MAX_REVERSIBLE_FILE_BYTES);
}

function validate_project(array $project, ?array $paths = null): array
{
    $manifest = scan_project_files($project);
    $issues = [];
    $targets = $paths ? array_flip(array_map('strval',$paths)) : null;
    foreach ($manifest as $file) {
        if ($targets !== null && !isset($targets[$file['path']])) continue;
        if (!$file['text'] || $file['size'] > MAX_EDITOR_BYTES) continue;
        $full = safe_project_file($project, $file['path'], true);
        $content = (string) file_get_contents($full);
        $ext = strtolower(pathinfo($file['path'], PATHINFO_EXTENSION));
        if ($ext === 'json') {
            json_decode($content, true);
            if (json_last_error() !== JSON_ERROR_NONE) $issues[] = ['file'=>$file['path'],'severity'=>'error','message'=>'Invalid JSON: '.json_last_error_msg()];
        } elseif (in_array($ext, ['yml','yaml'], true)) {
            if (str_contains($content, "\t")) $issues[] = ['file'=>$file['path'],'severity'=>'warning','message'=>'YAML contains tab characters.'];
        } elseif ($ext === 'php') {
            if (!str_contains($content, '<?php')) $issues[] = ['file'=>$file['path'],'severity'=>'error','message'=>'PHP file does not contain an opening tag.'];
            $lint = lint_php_file($full);
            if ($lint !== null) $issues[] = ['file'=>$file['path'],'severity'=>'error','message'=>$lint];
        } elseif (in_array($ext, ['js','mjs','cjs'], true)) {
            // Prefer the real JavaScript parser when Node is available. The
            // former generic delimiter scan did not receive the file extension,
            // so braces and parentheses inside template literals were counted
            // as real code and produced false “Unexpected closing delimiter”
            // warnings on valid Worker source files.
            if (shell_command_available('node')) {
                $nodeIssue = node_syntax_check_content($content, $ext);
                if ($nodeIssue !== null) {
                    $issues[] = ['file'=>$file['path'],'severity'=>'error','message'=>$nodeIssue['message']];
                }
            } else {
                $balance = bracket_balance($content, $ext);
                if ($balance !== null) $issues[] = ['file'=>$file['path'],'severity'=>'warning','message'=>$balance];
            }
        } elseif (in_array($ext, ['ts','tsx','jsx','css','scss'], true)) {
            $balance = bracket_balance($content, $ext);
            if ($balance !== null) $issues[] = ['file'=>$file['path'],'severity'=>'warning','message'=>$balance];
        } elseif (in_array($ext, ['html','htm'], true) && class_exists('DOMDocument')) {
            $dom = new DOMDocument();
            libxml_use_internal_errors(true);
            $dom->loadHTML($content, LIBXML_NOWARNING | LIBXML_NOERROR);
            libxml_clear_errors();
        }
        // Detect a real unresolved Git merge conflict, not decorative README
        // separators such as "====================". A conflict is only
        // reported when the opening marker, the exact seven-equals separator,
        // and the closing marker occur in the expected order.
        $mergeLines = preg_split('~\R~', $content) ?: [];
        $mergeOpen = false;
        $mergeSeparator = false;
        $hasMergeConflict = false;
        foreach ($mergeLines as $mergeLine) {
            if (preg_match('~^<<<<<<<(?: .*)?$~', $mergeLine)) {
                $mergeOpen = true;
                $mergeSeparator = false;
                continue;
            }
            if ($mergeOpen && $mergeLine === '=======') {
                $mergeSeparator = true;
                continue;
            }
            if ($mergeOpen && $mergeSeparator && preg_match('~^>>>>>>>(?: .*)?$~', $mergeLine)) {
                $hasMergeConflict = true;
                break;
            }
        }
        if ($hasMergeConflict) {
            $issues[] = ['file'=>$file['path'],'severity'=>'error','message'=>'Unresolved merge conflict marker detected.'];
        }
    }
    $required = match ($project['type']) {
        'electron' => ['package.json','main.js','preload.js'],
        'android' => ['package.json','capacitor.config.json','www/index.html'],
        'php_web' => ['index.php'],
        'pwa' => ['index.html','manifest.webmanifest','sw.js'],
        'api' => ['package.json','src/server.js'],
        'service' => ['package.json','src/service.js'],
        'docker' => ['package.json','Dockerfile'],
        default => [],
    };
    $pathsMap = array_flip(array_column($manifest,'path'));
    foreach ($required as $requiredPath) if (!isset($pathsMap[$requiredPath])) $issues[]=['file'=>$requiredPath,'severity'=>'error','message'=>'Required project file is missing.'];
    return ['valid'=>!array_filter($issues,static fn($i)=>$i['severity']==='error'),'issues'=>$issues,'checked_files'=>count($manifest)];
}

function nexa_glob_regex(string $pattern): string
{
    $pattern = str_replace('\\', '/', trim($pattern));
    $pattern = preg_replace('~^\./+~', '', $pattern) ?? $pattern;
    $quoted = preg_quote($pattern, '~');
    $quoted = str_replace('\\*\\*/', '(?:.*/)?', $quoted);
    $quoted = str_replace('\\*\\*', '.*', $quoted);
    $quoted = str_replace('\\*', '[^/]*', $quoted);
    $quoted = str_replace('\\?', '[^/]', $quoted);
    return '~^' . $quoted . '$~i';
}

function electron_build_file_patterns(array $package): array
{
    $configured = $package['build']['files'] ?? null;
    if (!is_array($configured) || $configured === []) return ['**/*'];
    $patterns = [];
    foreach ($configured as $entry) {
        if (is_string($entry) && trim($entry) !== '') {
            $patterns[] = trim($entry);
            continue;
        }
        if (!is_array($entry)) continue;
        $from = trim((string)($entry['from'] ?? ''));
        $filters = $entry['filter'] ?? ['**/*'];
        if (!is_array($filters)) $filters = [(string)$filters];
        foreach ($filters as $filter) {
            if (!is_string($filter) || trim($filter) === '') continue;
            $filter = ltrim(trim($filter), '/');
            $patterns[] = ($from !== '' ? rtrim(str_replace('\\','/',$from), '/') . '/' : '') . $filter;
        }
    }
    return $patterns ?: ['**/*'];
}

function electron_path_is_packaged(string $path, array $patterns): bool
{
    $path = ltrim(str_replace('\\', '/', $path), '/');
    $included = false;
    foreach ($patterns as $pattern) {
        $pattern = trim((string)$pattern);
        if ($pattern === '') continue;
        $negative = str_starts_with($pattern, '!');
        if ($negative) $pattern = substr($pattern, 1);
        if ($pattern === '') continue;
        if (preg_match(nexa_glob_regex($pattern), $path)) $included = !$negative;
    }
    return $included;
}

function electron_join_expression_path(string $expression): ?string
{
    if (!preg_match_all('/[\'\"]([^\'\"]+)[\'\"]/', $expression, $matches) || empty($matches[1])) return null;
    return implode('/', array_map(static fn(string $part): string => trim($part, '/\\'), $matches[1]));
}

function electron_resolve_from_main_directory(string $main, string $relative): string
{
    $main = ltrim(str_replace('\\', '/', trim($main)), '/');
    $relative = ltrim(str_replace('\\', '/', trim($relative)), '/');
    $base = trim(str_replace('\\', '/', dirname($main)), './');
    if ($base === '' || $base === '.') return $relative;
    return $base . '/' . $relative;
}

function electron_runtime_entries(array $project, array $package): array
{
    $main = ltrim(str_replace('\\', '/', trim((string)($package['main'] ?? 'main.js'))), '/');
    $mainFile = safe_project_file($project, $main, false);
    $content = is_file($mainFile) ? (string)file_get_contents($mainFile) : '';
    $renderers = [];
    if ($content !== '') {
        if (preg_match_all('/loadFile\s*\(\s*path\.join\s*\(\s*__dirname\s*,\s*([^\)]*)\)/i', $content, $matches)) {
            foreach ($matches[1] as $expression) {
                $path = electron_join_expression_path((string)$expression);
                if ($path !== null && $path !== '') {
                    // __dirname is the directory of the active main file.
                    $renderers[] = electron_resolve_from_main_directory($main, $path);
                }
            }
        }
        if (preg_match_all('/loadFile\s*\(\s*[\'"]([^\'"]+)[\'"]/i', $content, $matches)) {
            foreach ($matches[1] as $path) $renderers[] = str_replace('\\', '/', (string)$path);
        }
    }
    $preload = electron_resolve_from_main_directory($main, 'preload.js');
    if ($content !== '' && preg_match('/preload\s*:\s*path\.join\s*\(\s*__dirname\s*,\s*([^\)]*)\)/i', $content, $match)) {
        $resolved = electron_join_expression_path((string)$match[1]);
        if ($resolved !== null && $resolved !== '') {
            $preload = electron_resolve_from_main_directory($main, $resolved);
        }
    }
    return ['main'=>$main,'preload'=>$preload,'renderers'=>array_values(array_unique($renderers))];
}


/**
 * Classify how strictly Nexa must prove implementation completeness.
 * Complete products and complete features may never pass with demo shells,
 * disconnected modules or unverifiable acceptance criteria.
 */
function nexa_completion_scope(array $task, array $plan = []): string
{
    $declared = trim((string)($plan['completion_scope'] ?? ''));
    if (in_array($declared, ['incremental_change','complete_feature','complete_product'], true)) return $declared;
    $prompt = strtolower((string)($task['prompt'] ?? ''));
    if (preg_match('~\b(final phase|last phase|complete (?:the )?(?:program|application|software|project)|finish (?:the )?(?:program|application|software|project)|installable application|production ready|fase final|ultima fase|última fase|terminar (?:el|la) (?:programa|aplicaci[oó]n|software|proyecto)|programa completo|aplicaci[oó]n completa|crear (?:un|una) (?:programa|aplicaci[oó]n)|build (?:an?|the) (?:program|application|software)|create (?:an?|the) (?:program|application|software))\b~iu', $prompt)) {
        return 'complete_product';
    }
    if (preg_match('~\b(implement|integrate|functional|working|end.to.end|complete feature|implementar|integrar|funcional|que funcione|de extremo a extremo)\b~iu', $prompt)) {
        return 'complete_feature';
    }
    return 'incremental_change';
}

function nexa_normalized_implementation_contracts(array $plan): array
{
    $contracts = [];
    foreach ((array)($plan['implementation_contracts'] ?? []) as $index => $contract) {
        if (!is_array($contract)) continue;
        $id = trim((string)($contract['id'] ?? ''));
        $requirement = trim((string)($contract['requirement'] ?? ''));
        if ($id === '') $id = 'contract-' . ($index + 1);
        if ($requirement === '') continue;
        $contracts[] = [
            'id'=>$id,
            'requirement'=>$requirement,
            'evidence_paths'=>array_values(array_unique(array_filter(array_map(static fn($v): string => ltrim(str_replace('\\','/',trim((string)$v)), '/'), (array)($contract['evidence_paths'] ?? []))))),
            'evidence_markers'=>array_values(array_unique(array_filter(array_map(static fn($v): string => trim((string)$v), (array)($contract['evidence_markers'] ?? []))))),
            'test_scripts'=>array_values(array_unique(array_filter(array_map(static fn($v): string => trim((string)$v), (array)($contract['test_scripts'] ?? []))))),
            'user_flow'=>array_values(array_filter(array_map(static fn($v): string => trim((string)$v), (array)($contract['user_flow'] ?? [])))),
        ];
    }
    if ($contracts) return $contracts;

    $fallbackFiles = [];
    foreach ((array)($plan['affected_files'] ?? []) as $file) {
        if (!is_array($file) || in_array((string)($file['action'] ?? ''), ['inspect','delete'], true)) continue;
        $path = ltrim(str_replace('\\','/',trim((string)($file['path'] ?? ''))), '/');
        if ($path === '') continue;
        $fallbackFiles[] = ['path'=>$path,'search'=>strtolower($path . ' ' . (string)($file['reason'] ?? ''))];
    }
    foreach ((array)($plan['acceptance_criteria'] ?? []) as $index => $criterion) {
        $criterion = trim((string)$criterion);
        if ($criterion === '') continue;
        $tokens = array_values(array_unique(array_filter(
            preg_split('/[^a-z0-9_.-]+/i', strtolower($criterion)) ?: [],
            static fn(string $token): bool => strlen($token) >= 4
        )));
        $matchedPaths = [];
        foreach ($fallbackFiles as $candidate) {
            foreach ($tokens as $token) {
                if (str_contains($candidate['search'], $token)) { $matchedPaths[] = $candidate['path']; break; }
            }
            if (count($matchedPaths) >= 12) break;
        }
        if (!$matchedPaths) $matchedPaths = array_slice(array_column($fallbackFiles, 'path'), 0, 8);
        $contracts[] = [
            'id'=>'criterion-' . ($index + 1),
            'requirement'=>$criterion,
            'evidence_paths'=>array_values(array_unique($matchedPaths)),
            'evidence_markers'=>[],
            'test_scripts'=>[],
            'user_flow'=>[],
        ];
    }
    return $contracts;
}

function nexa_latest_task_implementation_evidence(int $taskId): array
{
    if ($taskId <= 0) return [];
    $stmt = db()->prepare("SELECT metadata_json FROM task_steps WHERE task_id=:task AND step IN ('implementation_gate','implementation_candidate') ORDER BY id DESC LIMIT 1");
    $stmt->execute([':task'=>$taskId]);
    $metadata = json_decode((string)($stmt->fetchColumn() ?: ''), true);
    return is_array($metadata) ? (array)($metadata['evidence'] ?? []) : [];
}

function nexa_latest_product_task(array $project): ?array
{
    $stmt = db()->prepare("SELECT * FROM tasks WHERE project_id=:project AND task_type<>'build_repair' AND plan_json IS NOT NULL AND trim(plan_json)<>'' ORDER BY id DESC LIMIT 1");
    $stmt->execute([':project'=>(int)$project['id']]);
    return $stmt->fetch() ?: null;
}

function nexa_source_text_map(array $project): array
{
    $map = [];
    foreach (scan_project_files($project, false) as $file) {
        $path = ltrim(str_replace('\\','/',(string)($file['path'] ?? '')), '/');
        if ($path === '' || empty($file['text']) || (int)($file['size'] ?? 0) > MAX_EDITOR_BYTES) continue;
        if (preg_match('~(^|/)(node_modules|vendor|\.git|dist|release|build|coverage|docs?|tests?|fixtures?|mocks?|examples?|scripts?|tools?)(/|$)~i', $path)) continue;
        $full = safe_project_file($project, $path, false);
        if (!is_file($full)) continue;
        $map[$path] = (string)file_get_contents($full);
    }
    return $map;
}


function nexa_strip_nonexecutable_comments(string $content, string $path): string
{
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (in_array($ext, ['js','mjs','cjs','ts','tsx','jsx','css','scss','cs','java'], true)) {
        $content = preg_replace('~/\*[\s\S]*?\*/~', '', $content) ?? $content;
        $content = preg_replace('~(^|\s)//[^\r\n]*~m', '$1', $content) ?? $content;
    } elseif (in_array($ext, ['html','htm','xml'], true)) {
        $content = preg_replace('~<!--[\s\S]*?-->~', '', $content) ?? $content;
    } elseif ($ext === 'php') {
        $content = preg_replace('~/\*[\s\S]*?\*/~', '', $content) ?? $content;
        $content = preg_replace('~(^|\s)//[^\r\n]*~m', '$1', $content) ?? $content;
        $content = preg_replace('~(^|\s)#[^\r\n]*~m', '$1', $content) ?? $content;
    }
    return $content;
}

function nexa_package_scripts(array $project): array
{
    $package = safe_project_file($project, 'package.json', false);
    if (!is_file($package) || filesize($package) > MAX_EDITOR_BYTES) return [];
    $json = json_decode((string)file_get_contents($package), true);
    return is_array($json['scripts'] ?? null) ? $json['scripts'] : [];
}


/**
 * Engineering plans usually describe tests as shell commands ("npm run test:unit")
 * while package.json stores the script under the key ("test:unit"). Normalize
 * both forms before deciding that a required test is missing.
 */
function nexa_package_script_key(string $declared): string
{
    $declared = trim($declared);
    if ($declared === '') return '';
    if (preg_match('~^(?:npm|pnpm)\s+run\s+(?:--silent\s+)?([^\s]+)~i', $declared, $match)) {
        return trim((string)$match[1]);
    }
    if (preg_match('~^npm\s+(?:test|t)(?:\s|$)~i', $declared)) return 'test';
    if (preg_match('~^yarn\s+(?:run\s+)?([^\s]+)~i', $declared, $match)) {
        return trim((string)$match[1]);
    }
    return $declared;
}

/**
 * Markers are semantic evidence, not formatting contracts. Match exact text
 * first, then ignore harmless whitespace and quote-style differences so
 * "contextIsolation:true" also verifies "contextIsolation: true" and
 * app.getPath("userData") verifies app.getPath('userData').
 */
function nexa_implementation_marker_present(string $combinedSource, string $marker): bool
{
    $marker = trim($marker);
    if ($marker === '') return true;
    if (str_contains($combinedSource, $marker)) return true;

    $compactSource = preg_replace('~\s+~u', '', $combinedSource) ?? $combinedSource;
    $compactMarker = preg_replace('~\s+~u', '', $marker) ?? $marker;
    if ($compactMarker !== '' && str_contains($compactSource, $compactMarker)) return true;

    $quoteFreeSource = str_replace(["'", '"', '`'], '', $compactSource);
    $quoteFreeMarker = str_replace(["'", '"', '`'], '', $compactMarker);
    return $quoteFreeMarker !== '' && str_contains($quoteFreeSource, $quoteFreeMarker);
}

/**
 * Read a declared evidence file or directory. Directory evidence is valid when
 * it exists and contains source files; its readable source is included in
 * marker verification with conservative limits.
 */
function nexa_contract_evidence_source(array $project, string $path, array $patterns, array &$contractIssues): string
{
    $full = safe_project_file($project, $path, false);
    if (is_file($full)) {
        if ((string)($project['type'] ?? '') === 'electron'
            && nexa_evidence_path_requires_packaging($path)
            && preg_match('~\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|node|dll|exe|sql)$~i', $path)
            && !electron_path_is_packaged($path, $patterns)) {
            $contractIssues[] = 'Runtime evidence file is not included in the packaged application: ' . $path;
        }
        if (is_text_file($path) && filesize($full) <= MAX_EDITOR_BYTES) {
            return nexa_strip_nonexecutable_comments((string)file_get_contents($full), $path);
        }
        return '';
    }

    if (!is_dir($full)) {
        $contractIssues[] = 'Evidence file is missing: ' . $path;
        return '';
    }

    $combined = '';
    $sourceFiles = 0;
    $workspaceRoot = rtrim((string)$project['workspace_path'], '/\\');
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($full, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($iterator as $file) {
        if (!$file->isFile() || ++$sourceFiles > 80) break;
        $relative = ltrim(str_replace('\\', '/', substr($file->getPathname(), strlen($workspaceRoot))), '/');
        if ((string)($project['type'] ?? '') === 'electron'
            && nexa_evidence_path_requires_packaging($relative)
            && preg_match('~\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|node|dll|exe|sql)$~i', $relative)
            && !electron_path_is_packaged($relative, $patterns)) {
            $contractIssues[] = 'Runtime evidence file is not included in the packaged application: ' . $relative;
        }
        if (!is_text_file($relative) || $file->getSize() > MAX_EDITOR_BYTES) continue;
        if (strlen($combined) >= MAX_CONTEXT_BYTES) break;
        $combined .= "\n" . nexa_strip_nonexecutable_comments((string)file_get_contents($file->getPathname()), $relative);
    }
    if ($sourceFiles === 0) $contractIssues[] = 'Evidence directory is empty: ' . $path;
    return $combined;
}


/**
 * Decide whether a declared evidence path must be shipped inside the installed
 * Electron application. Test sources, build scripts, audit reports and bridge
 * source code prove implementation during development but should not be
 * bundled into the commercial runtime. Runtime services, migrations, renderer
 * files and compiled bridge binaries still must be packaged.
 */
function nexa_evidence_path_requires_packaging(string $path): bool
{
    $path = strtolower(ltrim(str_replace('\\', '/', trim($path)), '/'));
    if ($path === '') return false;

    foreach ([
        'tests/', 'test/', '__tests__/', '.github/', 'scripts/', 'artifacts/',
        'reports/', 'docs/', 'documentation/', 'server/', 'build/'
    ] as $prefix) {
        if (str_starts_with($path, $prefix)) return false;
    }

    if (preg_match('~^bridge/.+\.(?:cs|csproj|sln|props|targets)$~i', $path)) return false;
    if (preg_match('~(?:^|/)(?:readme|license|changelog)(?:\.[^/]+)?$~i', $path)) return false;

    return true;
}


function nexa_electron_windows_target_names(array $package): array
{
    $configured = $package['build']['win']['target'] ?? [];
    if (is_string($configured)) $configured = [$configured];
    if (!is_array($configured)) return [];
    $targets = [];
    foreach ($configured as $entry) {
        if (is_string($entry)) $targets[] = strtolower(trim($entry));
        elseif (is_array($entry)) $targets[] = strtolower(trim((string)($entry['target'] ?? '')));
    }
    return array_values(array_unique(array_filter($targets)));
}

function nexa_workflow_source(array $project): string
{
    $root = safe_project_file($project, '.github/workflows', false);
    if (!is_dir($root)) return '';
    $combined = '';
    foreach (new DirectoryIterator($root) as $file) {
        if ($file->isDot() || !$file->isFile()) continue;
        if (!preg_match('~\.ya?ml$~i', $file->getFilename()) || $file->getSize() > MAX_EDITOR_BYTES) continue;
        $combined .= "\n" . (string)file_get_contents($file->getPathname());
    }
    return $combined;
}

function nexa_package_script_dependencies(array $scripts, string $scriptKey): array
{
    $command = trim((string)($scripts[$scriptKey] ?? ''));
    if ($command === '') return [];
    $dependencies = [];
    if (preg_match_all('~\b(?:npm|pnpm)\s+run\s+(?:--silent\s+)?([A-Za-z0-9:_.-]+)~i', $command, $matches)) {
        $dependencies = array_merge($dependencies, $matches[1]);
    }
    if (preg_match('~\bnpm\s+(?:test|t)(?:\s|$)~i', $command)) $dependencies[] = 'test';
    if (preg_match_all('~\byarn\s+(?:run\s+)?([A-Za-z0-9:_.-]+)~i', $command, $matches)) {
        $dependencies = array_merge($dependencies, $matches[1]);
    }
    return array_values(array_unique(array_filter(array_map('strval', $dependencies))));
}

function nexa_package_script_reachable(array $scripts, string $entry, string $target, array &$seen = []): bool
{
    if ($entry === $target) return true;
    if (isset($seen[$entry])) return false;
    $seen[$entry] = true;
    foreach (nexa_package_script_dependencies($scripts, $entry) as $dependency) {
        if (nexa_package_script_reachable($scripts, $dependency, $target, $seen)) return true;
    }
    return false;
}

function nexa_workflow_executes_package_script(array $project, array $scripts, string $target): bool
{
    if ($target === '' || !array_key_exists($target, $scripts)) return false;
    $workflow = nexa_workflow_source($project);
    if ($workflow === '') return false;
    $roots = [];
    if (preg_match_all('~\b(?:npm|pnpm)\s+run\s+(?:--silent\s+)?([A-Za-z0-9:_.-]+)~i', $workflow, $matches)) {
        $roots = array_merge($roots, $matches[1]);
    }
    if (preg_match('~\bnpm\s+(?:test|t)(?:\s|$)~i', $workflow)) $roots[] = 'test';
    if (preg_match_all('~\byarn\s+(?:run\s+)?([A-Za-z0-9:_.-]+)~i', $workflow, $matches)) {
        $roots = array_merge($roots, $matches[1]);
    }
    foreach (array_values(array_unique($roots)) as $root) {
        $seen = [];
        if (nexa_package_script_reachable($scripts, (string)$root, $target, $seen)) return true;
    }

    // A workflow may execute the exact underlying command instead of the npm alias.
    $command = preg_replace('~\s+~', ' ', trim((string)$scripts[$target])) ?? '';
    $normalizedWorkflow = preg_replace('~\s+~', ' ', $workflow) ?? $workflow;
    return $command !== '' && strlen($command) >= 12 && str_contains($normalizedWorkflow, $command);
}

function nexa_electron_structural_issue_map(array $project, array $package, array $sourceMap): array
{
    $issues = ['ipc'=>[], 'database'=>[], 'openai'=>[], 'packaging'=>[], 'workflow'=>[], 'ui'=>[]];
    if ((string)($project['type'] ?? '') !== 'electron') return $issues;

    $combined = implode("\n", array_values($sourceMap));
    $active = electron_active_ui_source($project);
    $activeScripts = (string)($active['scripts'] ?? '');

    $mainChannels = [];
    $clientChannels = [];
    if (preg_match_all('~ipcMain\s*\.\s*(?:handle|on)\s*\(\s*[\'"]([^\'"]+)[\'"]~i', $activeScripts, $matches)) $mainChannels = array_merge($mainChannels, $matches[1]);
    if (preg_match_all('~(?:registerHandler|registerIpcHandler|handleIpc)\s*\(\s*[\'"]([^\'"]+)[\'"]~i', $activeScripts, $matches)) $mainChannels = array_merge($mainChannels, $matches[1]);
    if (preg_match_all('~ipcRenderer\s*\.\s*(?:invoke|send|sendSync|on)\s*\(\s*[\'"]([^\'"]+)[\'"]~i', $activeScripts, $matches)) $clientChannels = array_merge($clientChannels, $matches[1]);
    if (preg_match_all('~(?:invoke|sendToMain)\s*\(\s*[\'"]([^\'"]+)[\'"]~i', $activeScripts, $matches)) $clientChannels = array_merge($clientChannels, $matches[1]);
    $mainChannels = array_values(array_unique($mainChannels));
    $clientChannels = array_values(array_unique($clientChannels));
    if (!$mainChannels) $issues['ipc'][] = 'No verifiable ipcMain handler registration is connected in the active Electron source.';
    if (!$clientChannels) $issues['ipc'][] = 'No verifiable ipcRenderer invoke/send channel is exposed through the active preload/runtime source.';
    if ($mainChannels && $clientChannels && !array_intersect($mainChannels, $clientChannels)) {
        $issues['ipc'][] = 'Electron main and preload/renderer do not share any verifiable IPC channel.';
    }

    $hasDatabaseProvider = preg_match('~\b(?:better-sqlite3|sqlite3|node:sqlite|Microsoft\.Data\.Sqlite|System\.Data\.SQLite)\b~i', $combined) === 1;
    $hasDatabaseOperations = preg_match('~\b(?:CREATE\s+TABLE|PRAGMA\s+[A-Za-z_]+|BEGIN\s+(?:IMMEDIATE|TRANSACTION)|INSERT\s+INTO|SELECT\s+.+\s+FROM)\b~is', $combined) === 1;
    if (!$hasDatabaseProvider) $issues['database'][] = 'No real SQLite provider is used by executable runtime source.';
    if (!$hasDatabaseOperations) $issues['database'][] = 'Runtime source does not contain verifiable SQLite schema or repository operations.';

    $hasOpenAIClient = preg_match('~\bnew\s+OpenAI\s*\(|\.responses\s*\.\s*(?:create|retrieve|cancel)\s*\(|/v1/responses\b~i', $combined) === 1;
    if (!$hasOpenAIClient) $issues['openai'][] = 'No real OpenAI Responses API client call is connected in executable runtime source.';

    $targets = nexa_electron_windows_target_names($package);
    if (!in_array('nsis', $targets, true)) $issues['packaging'][] = 'package.json build.win.target does not include a real NSIS installer.';
    if (!in_array('portable', $targets, true)) $issues['packaging'][] = 'package.json build.win.target does not include a portable Windows executable.';
    if (!in_array('zip', $targets, true)) $issues['packaging'][] = 'package.json build.win.target does not include the required Windows ZIP target.';
    if (empty($package['build']['asar'])) $issues['packaging'][] = 'Electron ASAR packaging is not enabled for the commercial runtime.';
    foreach ((array)($package['build']['files'] ?? []) as $entry) {
        $pattern = is_string($entry) ? $entry : (string)($entry['from'] ?? '');
        $normalized = strtolower(ltrim(str_replace('\\', '/', trim($pattern)), '/'));
        if (preg_match('~^(?:tests?|artifacts?|reports?)(?:/|$)~', $normalized)) {
            $issues['packaging'][] = 'Development-only path is included in the installed application: ' . $pattern;
        }
    }

    $workflow = nexa_workflow_source($project);
    if ($workflow === '') {
        $issues['workflow'][] = 'No GitHub Actions workflow source is present.';
    } else {
        foreach (['actions/setup-node', 'npm ci', 'npm test', 'electron-builder', 'actions/upload-artifact'] as $marker) {
            if (stripos($workflow, $marker) === false) $issues['workflow'][] = 'Windows workflow is missing required execution marker: ' . $marker;
        }
        if (stripos($combined, '.csproj') !== false || is_dir(safe_project_file($project, 'bridge', false))) {
            foreach (['actions/setup-dotnet', 'dotnet restore', 'dotnet build', 'dotnet test', 'dotnet publish'] as $marker) {
                if (stripos($workflow, $marker) === false) $issues['workflow'][] = 'Windows bridge workflow is missing required .NET step: ' . $marker;
            }
        }
    }

    $html = (string)($active['html'] ?? '');
    $hasDelegatedActionHandler = preg_match('~addEventListener\s*\(\s*[\'\"]click[\'\"]~i', $activeScripts) === 1
        && preg_match('~(?:dataset\.(?:nexaAction|action)|getAttribute\s*\(\s*[\'\"]data-(?:nexa-)?action)~i', $activeScripts) === 1;
    if ($html !== '' && preg_match_all('~<button\b([^>]*)>~i', $html, $buttons)) {
        $unwired = [];
        foreach ($buttons[1] as $attributes) {
            if (preg_match('~\b(?:disabled|type\s*=\s*[\'\"]?submit|onclick\s*=)~i', $attributes)) continue;
            $identifier = '';
            foreach (['data-nexa-action','data-action','data-section','data-testid','id'] as $attribute) {
                if (preg_match('~\b' . preg_quote($attribute, '~') . '\s*=\s*([\'\"])(.*?)\1~i', $attributes, $match)) {
                    $identifier = trim((string)$match[2]);
                    if ($identifier !== '') break;
                }
            }
            if ($identifier === '') {
                $unwired[] = '(button without stable id/action)';
                continue;
            }
            if ($hasDelegatedActionHandler && (stripos($attributes, 'data-action') !== false || stripos($attributes, 'data-nexa-action') !== false)) continue;
            if (stripos($attributes, 'data-section') !== false
                && preg_match('~(?:dataset\.section|getAttribute\s*\(\s*[\'"]data-section)~i', $activeScripts)
                && preg_match('~(?:\.nav-item|\[data-section\])~i', $activeScripts)) continue;
            if (!str_contains($activeScripts, $identifier)) $unwired[] = $identifier;
        }
        if ($unwired) $issues['ui'][] = 'Action buttons without a verifiable handler contract: ' . implode(', ', array_slice(array_values(array_unique($unwired)), 0, 12));
    }
    return $issues;
}

/**
 * Verify that approved behavior exists in executable source, is connected to
 * the active application, and has machine-verifiable tests. This gate is
 * intentionally independent from compilation and packaging success.
 */
function implementation_completeness_audit(array $project, array $task, array $plan = [], array $evidence = [], array $changedPaths = []): array
{
    $scope = nexa_completion_scope($task, $plan);
    $contracts = nexa_normalized_implementation_contracts($plan);
    $issues = [];
    $sourceMap = nexa_source_text_map($project);
    $scripts = nexa_package_scripts($project);
    $evidenceByContract = [];
    foreach ($evidence as $item) {
        if (!is_array($item)) continue;
        $id = trim((string)($item['contract_id'] ?? ''));
        if ($id !== '') $evidenceByContract[$id] = $item;
    }

    if (in_array($scope, ['complete_feature','complete_product'], true) && !$contracts) {
        $issues[] = ['severity'=>'error','file'=>'Approved engineering plan','message'=>'The task claims a complete feature or product but has no implementation contracts. Every requested capability must have source, marker, test and user-flow evidence.'];
    }

    $package = [];
    $patterns = ['**/*'];
    if ((string)($project['type'] ?? '') === 'electron') {
        $packagePath = safe_project_file($project, 'package.json', false);
        if (is_file($packagePath)) {
            $package = json_decode((string)file_get_contents($packagePath), true) ?: [];
            $patterns = electron_build_file_patterns($package);
        }
    }
    $structuralIssueMap = nexa_electron_structural_issue_map($project, $package, $sourceMap);

    $contractResults = [];
    foreach ($contracts as $contract) {
        $id = (string)$contract['id'];
        $reported = $evidenceByContract[$id] ?? [];
        $paths = array_values(array_unique(array_filter(array_merge(
            (array)$contract['evidence_paths'],
            array_map(static fn($v): string => ltrim(str_replace('\\','/',trim((string)$v)), '/'), (array)($reported['evidence_paths'] ?? []))
        ))));
        $markers = array_values(array_unique(array_filter(array_merge(
            (array)$contract['evidence_markers'],
            array_map(static fn($v): string => trim((string)$v), (array)($reported['evidence_markers'] ?? []))
        ))));
        $testScripts = array_values(array_unique(array_filter(array_merge(
            (array)$contract['test_scripts'],
            array_map(static fn($v): string => trim((string)$v), (array)($reported['test_scripts'] ?? []))
        ))));
        $contractIssues = [];

        if (in_array($scope, ['complete_feature','complete_product'], true) && !isset($evidenceByContract[$id])) {
            // The approved contract already declares the machine-verifiable
            // paths, markers and tests. Missing model-reported evidence is a
            // warning, not a substitute for inspecting the actual workspace.
            $issues[] = [
                'severity'=>'warning',
                'file'=>'Implementation contract ' . $id,
                'message'=>'Implementation evidence metadata was not available, so Nexa verified the approved contract directly against the active workspace.',
            ];
        }
        if (!$paths) $contractIssues[] = 'No executable source paths were declared.';
        if (!$markers && !$testScripts) $contractIssues[] = 'No stable code/UI/IPC markers or automated tests were declared.';
        if (in_array($scope, ['complete_feature','complete_product'], true) && empty($contract['user_flow'])) {
            $contractIssues[] = 'No real user flow was defined for acceptance.';
        }

        $combined = '';
        foreach ($paths as $path) {
            $combined .= "\n" . nexa_contract_evidence_source($project, $path, $patterns, $contractIssues);
        }
        foreach ($markers as $marker) {
            if ($marker === '') continue;
            if ($combined === '' || !nexa_implementation_marker_present($combined, $marker)) {
                $contractIssues[] = 'Required implementation marker was not found: ' . $marker;
            }
        }
        $resolvedTestScripts = [];
        foreach ($testScripts as $testScript) {
            $scriptKey = nexa_package_script_key($testScript);
            $resolvedTestScripts[$testScript] = $scriptKey;
            if ($scriptKey === '' || !array_key_exists($scriptKey, $scripts) || trim((string)$scripts[$scriptKey]) === '') {
                $contractIssues[] = 'Required package.json test script is missing: ' . $testScript;
                continue;
            }
            $command = trim((string)$scripts[$scriptKey]);
            if (preg_match('~(?:--if-present|process\.exit\(0\)|^echo\b|^write-host\b|^exit\s+0$)~i', $command)) {
                $contractIssues[] = 'Required test script is optional or a no-op instead of testing the feature: ' . $testScript;
            }
        }
        if ($scope === 'complete_product' && (string)($project['type'] ?? '') === 'electron') {
            foreach ($resolvedTestScripts as $declared=>$scriptKey) {
                if ($scriptKey !== '' && array_key_exists($scriptKey, $scripts) && !nexa_workflow_executes_package_script($project, $scripts, $scriptKey)) {
                    $contractIssues[] = 'Declared test script is not reached by the Windows workflow: ' . $declared;
                }
            }
            $requirementText = strtolower((string)$contract['requirement']);
            $categoryKeywords = [
                'ipc'=>['ipc','shell electron','preload','allowlist'],
                'database'=>['sqlite','database','migration','repositorio','repository','persist'],
                'openai'=>['openai','responses api','ai real'],
                'packaging'=>['packag','installer','portable','uninstall','reinstall','asar'],
                'workflow'=>['workflow','delivery gate','artifact','checksum','manifest','github'],
                'ui'=>['ui real','business module','emergency stop','whatsapp flow','handler'],
            ];
            foreach ($categoryKeywords as $category=>$keywords) {
                $matchesCategory = false;
                foreach ($keywords as $keyword) {
                    if (str_contains($requirementText, $keyword)) { $matchesCategory = true; break; }
                }
                if (!$matchesCategory) continue;
                foreach ((array)($structuralIssueMap[$category] ?? []) as $structuralIssue) {
                    $contractIssues[] = $structuralIssue;
                }
            }
        }
        foreach ($contractIssues as $message) {
            $issues[] = ['severity'=>'error','file'=>'Implementation contract ' . $id,'message'=>$message . ' Requirement: ' . (string)$contract['requirement']];
        }
        $expectedChecks = max(1, count($paths) + count($markers) + count($testScripts) + 1);
        $remainingChecks = count($contractIssues);
        $passedChecks = max(0, $expectedChecks - min($expectedChecks, $remainingChecks));
        $contractResults[] = [
            'id'=>$id,
            'requirement'=>(string)$contract['requirement'],
            'valid'=>$remainingChecks === 0,
            'paths'=>$paths,
            'markers'=>$markers,
            'tests'=>$testScripts,
            'test_keys'=>$resolvedTestScripts,
            'user_flow'=>(array)$contract['user_flow'],
            'issues'=>$contractIssues,
            'checks_total'=>$expectedChecks,
            'checks_passed'=>$passedChecks,
            'checks_remaining'=>$remainingChecks,
            'completion_percent'=>(int)round(($passedChecks / $expectedChecks) * 100),
        ];
    }

    $strictRuntimeScan = in_array($scope, ['complete_feature','complete_product'], true);
    $placeholderPatterns = [
        '~\bnot implemented\b~i'=>'Runtime still says “not implemented”.',
        '~\bdemo only\b~i'=>'Runtime still contains a demo-only implementation.',
        '~\bplaceholder (?:response|implementation|connector|screen|module|data)\b~i'=>'Runtime still contains a placeholder implementation.',
        '~\bmock(?:ed)? (?:response|connector|service|implementation|data)\b~i'=>'Runtime presents mock behavior as application behavior.',
        '~\bcoming soon\b~i'=>'Runtime defers requested behavior with “coming soon”.',
        '~\bcoming in phase\b~i'=>'Runtime defers requested behavior to another phase.',
        '~paste manually for now~i'=>'Runtime falls back to “paste manually for now” instead of implementing the requested integration.',
        '~requires the windows accessibility bridge~i'=>'Runtime exposes a missing Windows bridge instead of including it.',
        '~not available in this build~i'=>'Runtime says the requested capability is unavailable in this build.',
        '~\bTODO\s*:~i'=>'Runtime contains an unfinished TODO.',
        '~\bFIXME\s*:~i'=>'Runtime contains an unfinished FIXME.',
    ];
    if ($strictRuntimeScan) {
        foreach ($sourceMap as $path => $content) {
            foreach ($placeholderPatterns as $pattern => $message) {
                if (preg_match($pattern, $content, $match, PREG_OFFSET_CAPTURE)) {
                    $offset = (int)($match[0][1] ?? 0);
                    $line = substr_count(substr($content, 0, $offset), "\n") + 1;
                    $issues[] = ['severity'=>'error','file'=>$path,'line'=>$line,'message'=>$message . ' Complete-product and complete-feature tasks cannot ship simulated or deferred runtime behavior.'];
                }
            }
        }
    }

    if ($scope === 'complete_product' && (string)($project['type'] ?? '') === 'electron') {
        foreach (['test','test:acceptance','test:implementation'] as $requiredScript) {
            if (!isset($scripts[$requiredScript]) || trim((string)$scripts[$requiredScript]) === '') {
                $issues[] = ['severity'=>'error','file'=>'package.json','message'=>'Complete Electron products require the automated script “'.$requiredScript.'”; compiling or opening a window is not sufficient.'];
            }
        }
    }

    usort($issues, static function(array $a, array $b): int {
        $aContract = str_starts_with((string)($a['file'] ?? ''), 'Implementation contract') ? 1 : 0;
        $bContract = str_starts_with((string)($b['file'] ?? ''), 'Implementation contract') ? 1 : 0;
        if ($aContract !== $bContract) return $aContract <=> $bContract;
        return strcmp((string)($a['file'] ?? ''), (string)($b['file'] ?? ''));
    });
    $errors = array_values(array_filter($issues, static fn(array $issue): bool => ($issue['severity'] ?? '') === 'error'));
    return [
        'valid'=>count($errors) === 0,
        'scope'=>$scope,
        'issues'=>$issues,
        'contracts'=>$contractResults,
        'checked_source_files'=>count($sourceMap),
    ];
}


/**
 * Convert the low-level implementation checks into product-level progress.
 * Missing files, markers and tests remain available as technical details, but
 * the administrator sees one pending module per implementation contract.
 */
function implementation_completeness_summary(array $report): array
{
    $contracts = array_values(array_filter((array)($report['contracts'] ?? []), 'is_array'));
    $pending = array_values(array_filter($contracts, static fn(array $contract): bool => empty($contract['valid'])));
    $verified = array_values(array_filter($contracts, static fn(array $contract): bool => !empty($contract['valid'])));
    $errorIssues = array_values(array_filter((array)($report['issues'] ?? []), static fn(array $issue): bool => ($issue['severity'] ?? '') === 'error'));
    $warningIssues = array_values(array_filter((array)($report['issues'] ?? []), static fn(array $issue): bool => ($issue['severity'] ?? '') === 'warning'));
    $globalIssues = array_values(array_filter($errorIssues, static fn(array $issue): bool => !str_starts_with((string)($issue['file'] ?? ''), 'Implementation contract ')));

    $categories = [];
    foreach ($globalIssues as $issue) {
        $file = strtolower((string)($issue['file'] ?? ''));
        $message = strtolower((string)($issue['message'] ?? ''));
        if ($file === 'package.json' || str_contains($message, 'test script')) $category = 'Required product tests';
        elseif (str_contains($message, 'demo') || str_contains($message, 'placeholder') || str_contains($message, 'not implemented') || str_contains($message, 'coming soon') || str_contains($message, 'paste manually')) $category = 'Simulated or deferred runtime behavior';
        elseif (str_contains($message, 'packaged application') || str_contains($message, 'build.files')) $category = 'Packaged application wiring';
        else $category = 'Shared product validation';
        $categories[$category] = ($categories[$category] ?? 0) + 1;
    }

    $inProgress = array_values(array_filter($pending, static fn(array $contract): bool => (int)($contract['checks_passed'] ?? 0) > 0));
    $totalChecks = array_sum(array_map(static fn(array $contract): int => max(1, (int)($contract['checks_total'] ?? 1)), $contracts));
    $passedChecks = array_sum(array_map(static fn(array $contract): int => max(0, (int)($contract['checks_passed'] ?? 0)), $contracts));
    $completionPercent = $totalChecks > 0 ? (int)round(($passedChecks / $totalChecks) * 100) : 100;

    return [
        'valid'=>empty($pending) && empty($globalIssues),
        'total_contracts'=>count($contracts),
        'verified_contracts'=>count($verified),
        'partial_contracts'=>count($inProgress),
        'pending_contracts'=>count($pending),
        'pending'=>$pending,
        'in_progress'=>$inProgress,
        'verified'=>$verified,
        'technical_checks'=>count($errorIssues),
        'warnings'=>count($warningIssues),
        'global_checks'=>count($globalIssues),
        'global_categories'=>$categories,
        'checks_total'=>$totalChecks,
        'checks_passed'=>$passedChecks,
        'completion_percent'=>$completionPercent,
    ];
}

/**
 * Count module packages that were actually completed and retained. The task
 * attempt counter is reserved for failed retries inside the current package;
 * it is not the number of product modules that may ever be implemented.
 */
function implementation_completed_work_package_count(int $taskId): int
{
    $stmt = db()->prepare("SELECT COUNT(*) FROM task_steps WHERE task_id=:task AND step='module_package_completed' AND status='completed'");
    $stmt->execute([':task'=>$taskId]);
    return (int)$stmt->fetchColumn();
}

/**
 * Select a token-bounded implementation package. Complete products advance
 * one verified module at a time so the model receives enough source context
 * and output room to finish the module instead of scattering superficial
 * changes across several unrelated areas.
 */
function implementation_next_work_package(array $project, array $task, array $plan): array
{
    $report = implementation_completeness_audit($project, $task, $plan, nexa_latest_task_implementation_evidence((int)($task['id'] ?? 0)));
    $summary = implementation_completeness_summary($report);
    $pending = $summary['pending'];
    $remainingAttempts = max(1, (int)($task['max_attempts'] ?? 1) - (int)($task['attempt'] ?? 0));
    $maxContracts = defined('MAX_IMPLEMENTATION_CONTRACTS_PER_PACKAGE') ? MAX_IMPLEMENTATION_CONTRACTS_PER_PACKAGE : 1;
    $packageSize = $pending ? max(1, min($maxContracts, count($pending))) : 0;
    $target = $packageSize > 0 ? array_slice($pending, 0, $packageSize) : [];
    $deferred = $packageSize > 0 ? array_slice($pending, $packageSize) : [];
    $completedPackages = max(implementation_completed_work_package_count((int)($task['id'] ?? 0)), (int)($summary['verified_contracts'] ?? 0));

    return [
        'package_number'=>$completedPackages + 1,
        'completed_packages'=>$completedPackages,
        'remaining_attempts'=>$remainingAttempts,
        'target_contracts'=>$target,
        'target_contract_ids'=>array_values(array_filter(array_map(static fn(array $contract): string => (string)($contract['id'] ?? ''), $target))),
        'deferred_contract_ids'=>array_values(array_filter(array_map(static fn(array $contract): string => (string)($contract['id'] ?? ''), $deferred))),
        'progress'=>$summary,
        'token_policy'=>[
            'max_contracts'=>$maxContracts,
            'context_bytes'=>defined('MAX_IMPLEMENTATION_CONTEXT_BYTES') ? MAX_IMPLEMENTATION_CONTEXT_BYTES : 90000,
            'evidence_bytes'=>defined('MAX_IMPLEMENTATION_EVIDENCE_BYTES') ? MAX_IMPLEMENTATION_EVIDENCE_BYTES : 45000,
            'max_output_tokens'=>defined('OPENAI_IMPLEMENTATION_MAX_OUTPUT_TOKENS') ? OPENAI_IMPLEMENTATION_MAX_OUTPUT_TOKENS : 70000,
        ],
    ];
}

function project_implementation_gate_report(array $project, ?array $task = null): array
{
    $task = $task ?: nexa_latest_product_task($project);
    if (!$task) return ['valid'=>true,'scope'=>'none','issues'=>[],'contracts'=>[],'checked_source_files'=>0,'task_id'=>null];
    $plan = json_decode((string)($task['plan_json'] ?? ''), true);
    if (!is_array($plan)) $plan = [];
    $evidence = nexa_latest_task_implementation_evidence((int)$task['id']);
    $report = implementation_completeness_audit($project, $task, $plan, $evidence);
    $report['task_id'] = (int)$task['id'];
    $report['task_status'] = (string)($task['status'] ?? '');
    return $report;
}

function electron_delivery_audit(array $project, array $changedPaths = [], string $request = ''): array
{
    if ((string)($project['type'] ?? '') !== 'electron') return [];
    $issues = [];
    $packagePath = safe_project_file($project, 'package.json', false);
    if (!is_file($packagePath)) return [['file'=>'package.json','severity'=>'error','message'=>'Electron delivery requires package.json.']];
    $package = json_decode((string)file_get_contents($packagePath), true);
    if (!is_array($package)) return [['file'=>'package.json','severity'=>'error','message'=>'Electron package.json is invalid.']];
    $patterns = electron_build_file_patterns($package);
    $entries = electron_runtime_entries($project, $package);

    foreach ([$entries['main'], $entries['preload']] as $entry) {
        if ($entry === '') continue;
        if (!is_file(safe_project_file($project, $entry, false))) {
            $issues[] = ['file'=>$entry,'severity'=>'error','message'=>'Electron runtime entry file is missing.'];
        } elseif (!electron_path_is_packaged($entry, $patterns)) {
            $issues[] = ['file'=>$entry,'severity'=>'error','message'=>'Electron runtime entry is excluded by package.json build.files and will not exist in the installed application.'];
        }
    }
    if (!$entries['renderers']) {
        $issues[] = ['file'=>$entries['main'],'severity'=>'error','message'=>'Nexa could not identify the HTML file loaded by Electron. main.js must load the real application entry point with BrowserWindow.loadFile().'];
    }
    foreach ($entries['renderers'] as $renderer) {
        if (!is_file(safe_project_file($project, $renderer, false))) {
            $issues[] = ['file'=>$renderer,'severity'=>'error','message'=>'The renderer entry loaded by Electron does not exist.'];
        } elseif (!electron_path_is_packaged($renderer, $patterns)) {
            $issues[] = ['file'=>$renderer,'severity'=>'error','message'=>'The renderer entry is excluded by package.json build.files and the installer will show an older or empty interface.'];
        }
    }

    // Catch malformed nested renderer probes locally. A smoke harness that
    // embeds join('\n') inside executeJavaScript(`...`) must use String.raw;
    // otherwise the outer template turns the escape into a physical newline
    // and Chromium reports only the generic "Script failed to execute".
    if (function_exists('electron_ui_smoke_script_paths')) {
        foreach (electron_ui_smoke_script_paths($project) as $smokePath) {
            $smokeFile = safe_project_file($project, $smokePath, false);
            if (!is_file($smokeFile) || filesize($smokeFile) > MAX_EDITOR_BYTES) continue;
            $smokeSource = (string)file_get_contents($smokeFile);
            $hasNestedProbe = preg_match('~executeJavaScript\(\s*`~', $smokeSource) === 1;
            $hasEscapedJoin = str_contains($smokeSource, "join('\\n')") || str_contains($smokeSource, 'join("\\n")');
            if ($hasNestedProbe && $hasEscapedJoin) {
                $issues[] = [
                    'file'=>$smokePath,
                    'severity'=>'error',
                    'message'=>'Electron UI smoke embeds escaped renderer source in a normal template literal. Upgrade the harness to executeJavaScript(String.raw`...`) before dispatch.',
                ];
            }
        }
    }

    $changedPaths = array_values(array_unique(array_map(static fn($path): string => ltrim(str_replace('\\','/',(string)$path), '/'), $changedPaths)));
    if ($changedPaths) {
        $ignored = static fn(string $path): bool => preg_match('~(^|/)(\.github|docs?|tests?|scripts?|tools?|artifacts?|reports?|coverage|server|build)(/|$)|(^|/)(readme|changelog|license)(\.|$)|(^|/)package-lock\.json$~i', $path) === 1;
        $codePaths = array_values(array_filter($changedPaths, static fn(string $path): bool => !$ignored($path) && preg_match('~\.(js|mjs|cjs|ts|tsx|jsx|html|htm|css|json|node)$~i', $path) === 1));
        $excluded = array_values(array_filter($codePaths, static fn(string $path): bool => !electron_path_is_packaged($path, $patterns)));
        foreach ($excluded as $path) {
            $issues[] = ['file'=>$path,'severity'=>'error','message'=>'This changed application file is not included by package.json build.files, so GitHub would compile an installer without the new code.'];
        }

        $rendererDirs = [];
        foreach ($entries['renderers'] as $renderer) {
            $dir = trim(str_replace('\\','/',dirname($renderer)), '.');
            if ($dir !== '') $rendererDirs[] = rtrim($dir, '/') . '/';
        }
        $activeChanged = false;
        foreach ($changedPaths as $path) {
            if (in_array($path, [$entries['main'],$entries['preload'],'package.json'], true)) { $activeChanged = true; break; }
            foreach ($rendererDirs as $dir) if (str_starts_with($path, $dir)) { $activeChanged = true; break 2; }
        }
        $majorUiRequest = preg_match('~\b(new application|new program|create (an?|the) (application|program)|dashboard|interface|test lab|programa nuevo|nueva aplicaci[oó]n|crear (un|una) programa|interfaz)\b~iu', $request) === 1;
        if ($majorUiRequest && $codePaths && !$activeChanged) {
            $issues[] = ['file'=>$entries['renderers'][0] ?? $entries['main'],'severity'=>'error','message'=>'The request describes a new visible application, but none of Electron\'s active entry points or renderer files were changed. The build would still open the original template.'];
        }
    }
    return $issues;
}

/**
 * Read the active Electron renderer and nearby renderer JavaScript so Nexa can
 * compare delivery validators against machine-readable UI contracts.
 */
function electron_active_ui_source(array $project): array
{
    if ((string)($project['type'] ?? '') !== 'electron') return ['html'=>'','scripts'=>'','renderers'=>[]];
    $packagePath = safe_project_file($project, 'package.json', false);
    if (!is_file($packagePath)) return ['html'=>'','scripts'=>'','renderers'=>[]];
    $package = json_decode((string)file_get_contents($packagePath), true);
    if (!is_array($package)) return ['html'=>'','scripts'=>'','renderers'=>[]];
    $entries = electron_runtime_entries($project, $package);
    $html = '';
    $scripts = '';
    foreach ($entries['renderers'] as $renderer) {
        $rendererPath = safe_project_file($project, $renderer, false);
        if (is_file($rendererPath) && filesize($rendererPath) <= MAX_EDITOR_BYTES) {
            $html .= "\n" . (string)file_get_contents($rendererPath);
        }
        $dir = dirname($renderer);
        $dirPath = safe_project_file($project, $dir === '.' ? '' : $dir, false);
        if (!is_dir($dirPath)) continue;
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dirPath, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        $count = 0;
        foreach ($iterator as $file) {
            if (!$file->isFile() || ++$count > 30) break;
            $ext = strtolower($file->getExtension());
            if (!in_array($ext, ['js','mjs','cjs','ts','tsx','jsx'], true) || $file->getSize() > MAX_EDITOR_BYTES) continue;
            $scripts .= "\n" . (string)file_get_contents($file->getPathname());
        }
    }
    foreach ([$entries['main'], $entries['preload']] as $entry) {
        if ($entry === '') continue;
        $full = safe_project_file($project, $entry, false);
        if (is_file($full) && filesize($full) <= MAX_EDITOR_BYTES) $scripts .= "\n" . (string)file_get_contents($full);
    }
    return ['html'=>$html,'scripts'=>$scripts,'renderers'=>$entries['renderers']];
}

function electron_ui_contract_validator_paths(array $project): array
{
    $paths = ['scripts/validate-delivery.js', 'test-lab/scripts/validate.js'];
    foreach (scan_project_files($project, false) as $file) {
        $path = ltrim(str_replace('\\', '/', (string)($file['path'] ?? '')), '/');
        if ($path === '' || (int)($file['size'] ?? 0) > MAX_EDITOR_BYTES) continue;
        if (!preg_match('~(^|/)(scripts?|tests?)/.*(?:validate|delivery|contract|smoke).*\\.(?:js|mjs|cjs)$~i', $path)) continue;
        $full = safe_project_file($project, $path, false);
        if (!is_file($full)) continue;
        $content = (string)file_get_contents($full);
        if (str_contains($content, 'Required interface function is missing:') || str_contains($content, 'Required UI contract is missing:')) {
            $paths[] = $path;
        }
    }
    return array_values(array_unique($paths));
}

function electron_parse_literal_ui_contracts(string $script): array
{
    $contracts = [];
    foreach (['functions', 'contracts'] as $variable) {
        $pattern = '/const\\s+' . preg_quote($variable, '/') . '\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;/i';
        if (!preg_match($pattern, $script, $arrayMatch)) continue;
        if (!preg_match_all('/([\'\"])(.*?)\\1/s', (string)$arrayMatch[1], $matches)) continue;
        foreach ($matches[2] as $value) {
            $value = trim(stripcslashes((string)$value));
            if ($value !== '') $contracts[] = $value;
        }
    }
    return array_values(array_unique($contracts));
}

function electron_literal_ui_contract_validators(array $project): array
{
    $validators = [];
    foreach (electron_ui_contract_validator_paths($project) as $relative) {
        $full = safe_project_file($project, $relative, false);
        if (!is_file($full) || filesize($full) > MAX_EDITOR_BYTES) continue;
        $script = (string)file_get_contents($full);
        if (!str_contains($script, 'Required interface function is missing:') && !str_contains($script, 'Required UI contract is missing:')) continue;
        $validators[] = [
            'path' => $relative,
            'contracts' => electron_parse_literal_ui_contracts($script),
            'script' => $script,
            'stable' => str_contains($script, 'NEXA_STABLE_UI_CONTRACT_V1') || str_contains($script, 'NEXA_STABLE_UI_CONTRACT_V2'),
        ];
    }
    return $validators;
}

/**
 * Backward-compatible accessor retained for existing callers and older update
 * overlays. New code should inspect electron_literal_ui_contract_validators().
 */
function electron_literal_ui_contracts(array $project): array
{
    $validators = electron_literal_ui_contract_validators($project);
    return $validators[0] ?? ['path'=>'scripts/validate-delivery.js','contracts'=>[],'script'=>'','stable'=>false];
}

function electron_ui_contract_markers(string $label): array
{
    $slug = strtolower(trim((string)preg_replace('/[^a-z0-9]+/i', '-', $label), '-'));
    $markers = [
        $label,
        'data-nexa-action="'.$slug.'"',
        "data-nexa-action='".$slug."'",
        'data-testid="'.$slug.'"',
        "data-testid='".$slug."'",
        'id="'.$slug.'"',
        "id='".$slug."'",
    ];
    if ($label === 'Stop Test') {
        $markers = array_merge($markers, [
            'Cancel Test',
            'Cancel',
            '>Cancel<',
            '>Cancel</button>',
            'data-nexa-action="cancel-test"',
            "data-nexa-action='cancel-test'",
            'data-testid="cancel-test"',
            "data-testid='cancel-test'",
            'id="cancel-test"',
            "id='cancel-test'",
        ]);
    }
    return array_values(array_unique($markers));
}

/**
 * Detect fragile validators that use visible button copy as an API contract.
 * Missing semantic controls are blocking; recognized copy aliases are warnings
 * until the deterministic guard rewrites the validator before dispatch.
 */
function electron_ui_contract_audit(array $project): array
{
    if ((string)($project['type'] ?? '') !== 'electron') return [];
    $validators = electron_literal_ui_contract_validators($project);
    if (!$validators) return [];
    $ui = electron_active_ui_source($project);
    $issues = [];
    foreach ($validators as $validator) {
        foreach (($validator['contracts'] ?? []) as $label) {
            $exact = str_contains($ui['html'], (string)$label);
            if ($exact) continue;
            $aliasFound = false;
            foreach (electron_ui_contract_markers((string)$label) as $marker) {
                if ($marker !== $label && str_contains($ui['html'], $marker)) { $aliasFound = true; break; }
            }
            if ($label === 'Stop Test' && $aliasFound) {
                $hasCancellationCode = preg_match('/\b(cancel|abort|stop|terminate|kill)\b/i', $ui['scripts']) === 1;
                if (!$hasCancellationCode) {
                    $issues[] = ['file'=>$validator['path'],'severity'=>'error','message'=>'The interface uses a Cancel/Stop alias, but Nexa could not detect cancellation logic in the active renderer, preload or main process.'];
                    continue;
                }
            }
            if ($aliasFound) {
                $issues[] = ['file'=>$validator['path'],'severity'=>'warning','message'=>'Project validator uses fragile visible copy for “'.$label.'”. Nexa will convert it to a stable alias/data-action contract before GitHub dispatch.'];
            } else {
                $issues[] = ['file'=>$validator['path'],'severity'=>'error','message'=>'Project validator requires visible text “'.$label.'”, but the active renderer has no matching label or stable data-action/data-testid contract. Synchronize the interface and validator before building.'];
            }
        }
    }
    return $issues;
}

function lint_php_file(string $file): ?string
{
    if (!function_exists('shell_exec') || !is_callable('shell_exec')) return null;
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    if (in_array('shell_exec', $disabled, true)) return null;
    $output = shell_exec('php -l ' . escapeshellarg($file) . ' 2>&1');
    if ($output !== null && !str_contains($output, 'No syntax errors detected')) return trim($output);
    return null;
}

function source_delimiter_scan(string $content, string $extension = ''): array
{
    $extension = strtolower($extension);
    $pairs = ['{' => '}', '[' => ']', '(' => ')'];
    $closing = ['}' => '{', ']' => '[', ')' => '('];
    $stack = [];
    $issues = [];
    $length = strlen($content);
    $line = 1;
    $column = 0;
    $state = 'normal';
    $escaped = false;
    $regexClass = false;
    $canStartRegex = true;

    for ($i = 0; $i < $length; $i++) {
        $char = $content[$i];
        $next = $i + 1 < $length ? $content[$i + 1] : '';
        $column++;

        if ($state === 'line_comment') {
            if ($char === "\n") { $state = 'normal'; $line++; $column = 0; $canStartRegex = true; }
            continue;
        }
        if ($state === 'block_comment') {
            if ($char === '*' && $next === '/') { $state = 'normal'; $i++; $column++; continue; }
            if ($char === "\n") { $line++; $column = 0; }
            continue;
        }
        if (in_array($state, ['single_quote','double_quote','template'], true)) {
            if ($char === "\n") { $line++; $column = 0; }
            if ($escaped) { $escaped = false; continue; }
            if ($char === '\\') { $escaped = true; continue; }
            if (($state === 'single_quote' && $char === "'")
                || ($state === 'double_quote' && $char === '"')
                || ($state === 'template' && $char === '`')) {
                $state = 'normal';
                $canStartRegex = false;
            }
            continue;
        }
        if ($state === 'regex') {
            if ($char === "\n") {
                $issues[] = ['line'=>$line,'column'=>$column,'message'=>'Unterminated regular-expression literal.'];
                $state = 'normal'; $line++; $column = 0; $canStartRegex = true;
                continue;
            }
            if ($escaped) { $escaped = false; continue; }
            if ($char === '\\') { $escaped = true; continue; }
            if ($char === '[') { $regexClass = true; continue; }
            if ($char === ']' && $regexClass) { $regexClass = false; continue; }
            if ($char === '/' && !$regexClass) {
                $state = 'normal';
                while ($i + 1 < $length && preg_match('/[a-z]/i', $content[$i + 1])) { $i++; $column++; }
                $canStartRegex = false;
            }
            continue;
        }

        if ($char === "\n") { $line++; $column = 0; $canStartRegex = true; continue; }
        if ($char === '/' && $next === '/') { $state = 'line_comment'; $i++; $column++; continue; }
        if ($char === '/' && $next === '*') { $state = 'block_comment'; $i++; $column++; continue; }
        if ($char === "'") { $state = 'single_quote'; $escaped = false; continue; }
        if ($char === '"') { $state = 'double_quote'; $escaped = false; continue; }
        if ($char === '`' && in_array($extension, ['js','mjs','cjs','ts','tsx','jsx'], true)) { $state = 'template'; $escaped = false; continue; }
        if ($char === '/' && in_array($extension, ['js','mjs','cjs','ts','tsx','jsx'], true) && $canStartRegex && $next !== '=' && $next !== '') {
            $state = 'regex'; $escaped = false; $regexClass = false; continue;
        }

        if (isset($pairs[$char])) {
            $stack[] = ['char'=>$char,'line'=>$line,'column'=>$column];
            $canStartRegex = true;
            continue;
        }
        if (isset($closing[$char])) {
            $expected = $closing[$char];
            $top = end($stack);
            if (!$top || ($top['char'] ?? '') !== $expected) {
                $issues[] = ['line'=>$line,'column'=>$column,'message'=>'Unexpected closing delimiter '.$char.'.'];
            } else {
                array_pop($stack);
            }
            $canStartRegex = false;
            continue;
        }

        if (preg_match('/[A-Za-z0-9_$]/', $char)) {
            $canStartRegex = false;
        } elseif (!ctype_space($char)) {
            $canStartRegex = !in_array($char, ['.', ']', ')'], true);
        }
    }

    if ($state === 'block_comment') $issues[] = ['line'=>$line,'column'=>max(1,$column),'message'=>'Unterminated block comment.'];
    if (in_array($state, ['single_quote','double_quote','template'], true)) $issues[] = ['line'=>$line,'column'=>max(1,$column),'message'=>'Unterminated string or template literal.'];
    if ($state === 'regex') $issues[] = ['line'=>$line,'column'=>max(1,$column),'message'=>'Unterminated regular-expression literal.'];
    foreach (array_reverse($stack) as $open) {
        $issues[] = [
            'line'=>(int)$open['line'],
            'column'=>(int)$open['column'],
            'message'=>'Opening delimiter '.$open['char'].' is not closed with '.$pairs[$open['char']].'.',
        ];
    }
    return $issues;
}

function shell_command_available(string $command): bool
{
    if (!function_exists('shell_exec') || !is_callable('shell_exec')) return false;
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    if (in_array('shell_exec', $disabled, true)) return false;
    $probe = shell_exec('command -v '.escapeshellarg($command).' 2>/dev/null');
    return trim((string)$probe) !== '';
}

function node_syntax_check_content(string $content, string $extension): ?array
{
    if (!in_array(strtolower($extension), ['js','mjs','cjs'], true) || !shell_command_available('node')) return null;
    $temp = tempnam(sys_get_temp_dir(), 'nexa-js-');
    if ($temp === false) return null;
    $target = $temp.'.'.strtolower($extension);
    @rename($temp, $target);
    try {
        if (file_put_contents($target, $content, LOCK_EX) === false) return null;
        $output = shell_exec('node --check '.escapeshellarg($target).' 2>&1');
        $exitOutput = trim((string)$output);
        if ($exitOutput === '') return null;
        $line = null;
        if (preg_match('/'.preg_quote($target,'/').':(\d+)/', $exitOutput, $match)) $line = (int)$match[1];
        $message = 'JavaScript syntax validation failed.';
        if (preg_match('/SyntaxError:\s*([^\r\n]+)/', $exitOutput, $match)) $message = 'JavaScript syntax error: '.trim((string)$match[1]);
        return ['line'=>$line,'column'=>null,'message'=>$message];
    } finally {
        @unlink($target);
    }
}

function php_syntax_check_content(string $content): ?array
{
    if (!function_exists('shell_exec') || !is_callable('shell_exec')) return null;
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    if (in_array('shell_exec', $disabled, true)) return null;
    $temp = tempnam(sys_get_temp_dir(), 'nexa-php-');
    if ($temp === false) return null;
    try {
        if (file_put_contents($temp, $content, LOCK_EX) === false) return null;
        $output = trim((string)shell_exec('php -l '.escapeshellarg($temp).' 2>&1'));
        if ($output === '' || str_contains($output, 'No syntax errors detected')) return null;
        $line = null;
        if (preg_match('/on line\s+(\d+)/i', $output, $match)) $line = (int)$match[1];
        $message = preg_replace('/\s+in\s+'.preg_quote($temp,'/').'\s+on line\s+\d+/i', '', $output);
        return ['line'=>$line,'column'=>null,'message'=>trim((string)($message ?: 'PHP syntax validation failed.'))];
    } finally {
        @unlink($temp);
    }
}

function bracket_balance(string $content, string $extension = ''): ?string
{
    $issues = source_delimiter_scan($content, $extension);
    return $issues ? (string)$issues[0]['message'] : null;
}

function upsert_project_memory(int $projectId, string $category, string $key, string $content, int $importance = 5, ?int $taskId = null): void
{
    $stmt = db()->prepare('INSERT INTO ai_memory (project_id,category,memory_key,content,importance,source_task_id,created_at,updated_at)
        VALUES (:project,:category,:key,:content,:importance,:task,:created,:updated)
        ON CONFLICT(project_id,memory_key) DO UPDATE SET category=excluded.category,content=excluded.content,importance=excluded.importance,source_task_id=excluded.source_task_id,updated_at=excluded.updated_at');
    $stmt->execute([':project'=>$projectId,':category'=>$category,':key'=>$key,':content'=>$content,':importance'=>max(1,min(10,$importance)),':task'=>$taskId,':created'=>now(),':updated'=>now()]);
}
