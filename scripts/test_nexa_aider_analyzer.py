import importlib.util
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nexa_aider_analysis', ROOT/'lib'/'nexa-aider-analyzer.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Pos:
    def __init__(self, row, column=0):
        self.row=row; self.column=column
class Node:
    def __init__(self, kind, start, end, text, children=(), name=None):
        self.type=kind
        self.start_byte=start; self.end_byte=end
        self.start_point=Pos(text[:start].count(b'\n'))
        self.end_point=Pos(text[:end].count(b'\n'),len(text[:end].split(b'\n')[-1]))
        self.named_children=list(children)
        self._name=name
    def child_by_field_name(self, name):
        return self._name if name=='name' else None

class Parser:
    def parse(self, source):
        ident=b'guardarCliente'
        pos=source.find(ident)
        if pos<0: return types.SimpleNamespace(root_node=Node('module',0,len(source),source))
        nm=Node('identifier',pos,pos+len(ident),source)
        fn=Node('function_declaration',pos,pos+len(ident),source,[nm],nm)
        root=Node('module',0,len(source),source,[fn])
        return types.SimpleNamespace(root_node=root)

class AnalyzerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=pathlib.Path(self.tmp.name)
        (self.root/'one.js').write_text('function guardarCliente() { return true; }\n',encoding='utf-8')
        (self.root/'two.js').write_text('function guardarCliente() { return false; }\n',encoding='utf-8')
        self.parser=Parser()
        self.fake_grep=types.ModuleType('grep_ast')
        self.fake_tsl=types.ModuleType('grep_ast.tsl')
        self.fake_grep.filename_to_lang=lambda fname: 'javascript' if fname.endswith('.js') else None
        self.fake_tsl.get_parser=lambda lang:self.parser

    def test_symbols_lines_and_sha256(self):
        with patch.dict(sys.modules,{'grep_ast':self.fake_grep,'grep_ast.tsl':self.fake_tsl}):
            data=mod.scan(str(self.root))
        self.assertEqual(data['filesAnalyzed'],2)
        self.assertEqual(data['files'][0]['symbols'][0]['type'],'function')
        self.assertEqual(data['files'][0]['symbols'][0]['name'],'guardarCliente')
        self.assertEqual(data['files'][0]['symbols'][0]['startLine'],1)
        self.assertEqual(data['files'][0]['symbols'][0]['endLine'],1)
        self.assertEqual(len(data['files'][0]['sha256']),64)
        self.assertFalse(data['partial'])

    def test_pagination(self):
        with patch.dict(sys.modules,{'grep_ast':self.fake_grep,'grep_ast.tsl':self.fake_tsl}):
            a=mod.scan(str(self.root),max_files=1,offset=0)
            b=mod.scan(str(self.root),max_files=1,offset=1)
        self.assertEqual(a['nextOffset'],1)
        self.assertIsNone(b['nextOffset'])
        self.assertTrue(a['partial'])
        self.assertEqual(b['files'][0]['path'],'two.js')

    def test_no_walk_into_untrusted_symlink(self):
        secret=self.root.parent/'secret-aider-test.js'
        try:
            (self.root/'secret.js').symlink_to(secret)
        except (OSError,NotImplementedError):
            self.skipTest('Symlinks not supported')
        with patch.dict(sys.modules,{'grep_ast':self.fake_grep,'grep_ast.tsl':self.fake_tsl}):
            data=mod.scan(str(self.root))
        self.assertEqual(data['filesAnalyzed'],2)

    def test_no_project_file_execution(self):
        import inspect
        code=inspect.getsource(mod)
        self.assertNotIn('exec(',code)
        self.assertNotIn('eval(',code)
        self.assertNotIn('subprocess.',code)

if __name__=='__main__':
    unittest.main()
