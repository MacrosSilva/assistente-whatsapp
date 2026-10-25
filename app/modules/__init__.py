"""Descobre automaticamente todos os módulos em app/modules/."""
import importlib
import pkgutil

from .base import Module


def descobrir():
    classes = {}
    for info in pkgutil.iter_modules(__path__):
        if info.name == "base":
            continue
        mod = importlib.import_module(f"{__name__}.{info.name}")
        for obj in vars(mod).values():
            if isinstance(obj, type) and issubclass(obj, Module) and obj is not Module and obj.nome:
                classes[obj.nome] = obj
    return classes
