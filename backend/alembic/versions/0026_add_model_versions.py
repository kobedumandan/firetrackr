"""Durable offline model registry and cross-worker retrain guard.

Revision ID: 0026
Revises: 0025
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "model_versions",
        sa.Column("version", sa.String(64), primary_key=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("label_hash", sa.String(64), nullable=False),
        sa.Column("split_version", sa.String(100), nullable=False),
        sa.Column("threshold", sa.Float()),
        sa.Column("metrics", sa.JSON()),
        sa.Column("report", sa.JSON()),
        sa.Column("job_id", sa.String(64), unique=True),
        sa.Column("champion_version", sa.String(64)),
        sa.Column("bundle_manifest_sha256", sa.String(64)),
        sa.Column("error", sa.Text()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("promoted_by", sa.Integer(), sa.ForeignKey("users.user_id")),
        sa.Column("promoted_at", sa.DateTime(timezone=True)),
        sa.Column("rejected_by", sa.Integer(), sa.ForeignKey("users.user_id")),
        sa.Column("rejected_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('training','failed','candidate','scheduled','champion','rejected','archived')",
                           name="ck_model_versions_status"),
    )
    for status in ("training", "champion"):
        op.create_index(f"uq_model_versions_{status}", "model_versions", ["status"],
                        unique=True, postgresql_where=sa.text(f"status = '{status}'"))


def downgrade():
    op.drop_table("model_versions")
