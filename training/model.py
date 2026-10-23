"""SegmentGAT copied verbatim from notebook Cell 16; checkpoint compatible."""
import torch
import torch.nn.functional as F
from torch_geometric.nn import GATConv


class SegmentGAT(torch.nn.Module):
    def __init__(self, in_ch, hid=64, heads=4, dropout=0.35):
        super().__init__()

        self.conv1 = GATConv(
            in_ch,
            hid,
            heads=heads,
            dropout=dropout
        )

        self.conv2 = GATConv(
            hid * heads,
            hid,
            heads=1,
            dropout=dropout
        )

        self.norm1 = torch.nn.LayerNorm(hid * heads)
        self.norm2 = torch.nn.LayerNorm(hid)

        self.dropout = dropout

        self.cls_head = torch.nn.Linear(hid, 2)
        self.reg_head = torch.nn.Linear(hid, 1)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index)
        x = self.norm1(x)
        x = F.elu(x)
        x = F.dropout(x, self.dropout, training=self.training)

        x = self.conv2(x, edge_index)
        x = self.norm2(x)
        x = F.elu(x)

        out_cls = self.cls_head(x)
        out_reg = self.reg_head(x).squeeze(-1)

        return out_reg, out_cls
