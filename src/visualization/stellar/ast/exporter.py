"""
AST Exporter for Soroban Contracts

This module handles exporting visualized AST structures to various output formats.
"""

import os
import subprocess
from typing import Optional, Dict, Any
from pathlib import Path
import json

from .visualizer import ASTVisualizer, OutputFormat, VisualizationConfig


class ASTExporter:
    """
    Exporter for AST visualizations to multiple output formats.
    
    Supports PNG, SVG, DOT, and JSON formats.
    """
    
    def __init__(self, config: Optional[VisualizationConfig] = None):
        """
        Initialize the AST exporter.
        
        Args:
            config: Visualization configuration options
        """
        self.visualizer = ASTVisualizer(config)
        self.config = config or VisualizationConfig()
    
    def export(
        self,
        ast_data: Dict[str, Any],
        output_path: str,
        format: OutputFormat = OutputFormat.PNG
    ) -> str:
        """
        Export AST visualization to specified format.
        
        Args:
            ast_data: Parsed AST data (UnifiedAST structure)
            output_path: Path where the output file will be saved
            format: Output format (PNG, SVG, DOT, or JSON)
            
        Returns:
            Path to the generated file
            
        Raises:
            ValueError: If format is not supported or export fails
            RuntimeError: If graphviz is not available for PNG/SVG export
        """
        # Ensure output directory exists
        output_dir = os.path.dirname(output_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        
        if format == OutputFormat.JSON:
            return self._export_json(ast_data, output_path)
        elif format == OutputFormat.DOT:
            return self._export_dot(ast_data, output_path)
        elif format in [OutputFormat.PNG, OutputFormat.SVG]:
            return self._export_graph(ast_data, output_path, format)
        else:
            raise ValueError(f"Unsupported format: {format}")
    
    def _export_json(self, ast_data: Dict[str, Any], output_path: str) -> str:
        """Export AST as JSON format"""
        json_output = self.visualizer.to_json(ast_data)
        
        # Ensure output path has .json extension
        if not output_path.endswith('.json'):
            output_path = output_path.rsplit('.', 1)[0] + '.json'
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(json_output)
        
        return output_path
    
    def _export_dot(self, ast_data: Dict[str, Any], output_path: str) -> str:
        """Export AST as DOT format"""
        dot_output = self.visualizer.visualize(ast_data)
        
        # Ensure output path has .dot extension
        if not output_path.endswith('.dot'):
            output_path = output_path.rsplit('.', 1)[0] + '.dot'
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(dot_output)
        
        return output_path
    
    def _export_graph(
        self,
        ast_data: Dict[str, Any],
        output_path: str,
        format: OutputFormat
    ) -> str:
        """
        Export AST as PNG or SVG using graphviz.
        
        Args:
            ast_data: Parsed AST data
            output_path: Output file path
            format: PNG or SVG
            
        Returns:
            Path to generated file
            
        Raises:
            RuntimeError: If graphviz is not available
        """
        # Check if graphviz is available
        if not self._check_graphviz_available():
            raise RuntimeError(
                "Graphviz is not installed or not in PATH. "
                "Please install graphviz to export PNG or SVG formats. "
                "Visit https://graphviz.org/download/ for installation instructions."
            )
        
        # Generate DOT format
        dot_output = self.visualizer.visualize(ast_data)
        
        # Ensure output path has correct extension
        ext = '.png' if format == OutputFormat.PNG else '.svg'
        if not output_path.endswith(ext):
            output_path = output_path.rsplit('.', 1)[0] + ext
        
        # Write temporary DOT file
        temp_dot_path = output_path.rsplit('.', 1)[0] + '_temp.dot'
        with open(temp_dot_path, 'w', encoding='utf-8') as f:
            f.write(dot_output)
        
        try:
            # Run graphviz to generate output
            engine = 'dot'  # Use dot engine for hierarchical layouts
            result = subprocess.run(
                [engine, '-T', format.value, temp_dot_path, '-o', output_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                raise RuntimeError(
                    f"Graphviz failed to generate {format.value.upper()}: {result.stderr}"
                )
            
            return output_path
            
        finally:
            # Clean up temporary DOT file
            if os.path.exists(temp_dot_path):
                os.remove(temp_dot_path)
    
    def _check_graphviz_available(self) -> bool:
        """Check if graphviz is available in the system"""
        try:
            result = subprocess.run(
                ['dot', '-V'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def export_multiple_formats(
        self,
        ast_data: Dict[str, Any],
        base_path: str,
        formats: list[OutputFormat]
    ) -> list[str]:
        """
        Export AST visualization to multiple formats at once.
        
        Args:
            ast_data: Parsed AST data
            base_path: Base path for output files (without extension)
            formats: List of formats to export
            
        Returns:
            List of paths to generated files
        """
        generated_files = []
        
        for format in formats:
            try:
                output_path = self.export(ast_data, base_path, format)
                generated_files.append(output_path)
            except Exception as e:
                print(f"Warning: Failed to export {format.value}: {e}")
        
        return generated_files
    
    def export_large_ast(
        self,
        ast_data: Dict[str, Any],
        output_path: str,
        format: OutputFormat = OutputFormat.PNG,
        chunk_size: int = 500
    ) -> list[str]:
        """
        Export large AST structures by chunking them into manageable parts.
        
        Args:
            ast_data: Parsed AST data
            output_path: Base path for output files
            format: Output format
            chunk_size: Maximum nodes per chunk
            
        Returns:
            List of paths to generated chunk files
        """
        # Create a new visualizer with reduced limits
        chunk_config = VisualizationConfig(
            max_nodes=chunk_size,
            max_depth=self.config.max_depth,
            show_line_numbers=self.config.show_line_numbers,
            show_types=self.config.show_types,
            collapse_similar=True
        )
        
        chunk_visualizer = ASTVisualizer(chunk_config)
        self.visualizer = chunk_visualizer
        
        # For large ASTs, export each contract separately
        generated_files = []
        contracts = ast_data.get("contracts", [])
        
        if len(contracts) > 1:
            # Export each contract separately
            for i, contract in enumerate(contracts):
                chunked_ast = {
                    "language": ast_data.get("language"),
                    "source": ast_data.get("source"),
                    "file_path": ast_data.get("file_path"),
                    "contracts": [contract],
                    "structs": [],
                    "enums": []
                }
                
                chunk_path = f"{output_path}_contract_{i+1}"
                try:
                    output_file = self.export(chunked_ast, chunk_path, format)
                    generated_files.append(output_file)
                except Exception as e:
                    print(f"Warning: Failed to export contract {i+1}: {e}")
        else:
            # Single contract, try to export with chunking
            try:
                output_file = self.export(ast_data, output_path, format)
                generated_files.append(output_file)
            except Exception as e:
                print(f"Warning: Failed to export AST: {e}")
        
        return generated_files


def load_ast_from_json(json_path: str) -> Dict[str, Any]:
    """
    Load AST data from a JSON file.
    
    Args:
        json_path: Path to JSON file containing AST data
        
    Returns:
        AST data as dictionary
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def create_ast_exporter(
    max_nodes: int = 1000,
    max_depth: int = 100,
    show_line_numbers: bool = True,
    show_types: bool = True
) -> ASTExporter:
    """
    Factory function to create an AST exporter with custom configuration.
    
    Args:
        max_nodes: Maximum number of nodes to render
        max_depth: Maximum depth to traverse
        show_line_numbers: Whether to show line numbers
        show_types: Whether to show type information
        
    Returns:
        Configured ASTExporter instance
    """
    config = VisualizationConfig(
        max_nodes=max_nodes,
        max_depth=max_depth,
        show_line_numbers=show_line_numbers,
        show_types=show_types
    )
    
    return ASTExporter(config)
