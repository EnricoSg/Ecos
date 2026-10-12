import sys
from pathlib import Path

# Permite importar os módulos de ai/ (banco, anomaly_detector) nos testes
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
