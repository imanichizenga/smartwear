from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class Principal:
    kind: Literal["customer", "rider", "admin"]
    user: object | None = None  # accounts.User
    admin: object | None = None  # accounts.AdminUser
    session_id: str | None = None
    mfa_passed: bool = True

    @property
    def id(self) -> str:
        obj = self.admin if self.kind == "admin" else self.user
        return str(obj.pk) if obj is not None else ""  # type: ignore[union-attr]

    @property
    def is_authenticated(self) -> bool:
        return True
