"""Notebook Cell 17 CPU optimizer and early stopping; threshold search is vectorized."""
import torch
import torch.nn.functional as F
from training.threshold import threshold_search_conservative

def get_conservative_class_weights(data):
    """
    Balanced class weights.

    The goal is not to force too many constrained predictions.
    This keeps the constrained class important without making GAT too aggressive.
    """

    y_train = data.y_cls[data.train_mask]

    pos = float(y_train.sum().item())
    neg = float(len(y_train) - pos)

    if pos == 0:
        weight_pos = 1.0
    else:
        ratio = neg / pos

        # Balanced cap.
        # Lower than aggressive training, higher than strict conservative.
        weight_pos = min(1.85, ratio ** 0.32)

    return torch.tensor(
        [1.0, weight_pos],
        dtype=torch.float32
    ).to(data.y_cls.device)


def train_model_conservative(
    model,
    data,
    name,
    epochs=700,
    lr=0.002,
    patience=80
):
    """
    Performance-balanced training.

    Kept function name train_model_conservative so Cell 18 does not break.
    """

    model = model.to(data.x.device)

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr,
        weight_decay=6e-4
    )

    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="max",
        patience=20,
        factor=0.5
    )

    class_weights = get_conservative_class_weights(data)

    print("")
    print(f"Training PERFORMANCE-BALANCED {name}")
    print(
        f"Class weights: normal={class_weights[0].item():.2f}, "
        f"constrained={class_weights[1].item():.2f}"
    )

    best_val_score = -1.0
    best_state = None
    bad_epochs = 0

    for ep in range(epochs):
        model.train()
        optimizer.zero_grad()

        edge_index_for_train = data.train_edge_index if hasattr(data, "train_edge_index") else data.edge_index

        out_reg, out_cls = model(data.x, edge_index_for_train)

        loss_cls = F.cross_entropy(
            out_cls[data.train_mask],
            data.y_cls[data.train_mask],
            weight=class_weights,
            label_smoothing=0.03
        )

        loss_reg = F.smooth_l1_loss(
            out_reg[data.train_mask],
            data.y_reg[data.train_mask]
        )

        # Classification remains dominant, but regression is still included.
        loss = 0.86 * loss_cls + 0.14 * loss_reg

        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        model.eval()

        with torch.no_grad():
            _, val_cls = model(data.x, data.edge_index)
            val_probs = F.softmax(val_cls, dim=1)[:, 1].detach().cpu().numpy()

        val_mask_np = data.val_mask.detach().cpu().numpy()
        val_true = data.y_cls[data.val_mask].detach().cpu().numpy()
        val_prob = val_probs[val_mask_np]

        val_threshold, val_info = threshold_search_conservative(
            val_true,
            val_prob
        )

        val_score = val_info["score"] if val_info is not None else 0.0

        scheduler.step(val_score)

        if val_score > best_val_score + 0.001:
            best_val_score = val_score
            best_state = {
                k: v.detach().cpu().clone()
                for k, v in model.state_dict().items()
            }
            bad_epochs = 0
        else:
            bad_epochs += 1

        if ep % 50 == 0:
            print(
                f"Epoch {ep:03d} | "
                f"loss={loss.item():.4f} | "
                f"val_score={val_score:.4f} | "
                f"val_t={val_threshold:.2f} | "
                f"val_precision={val_info['precision']:.4f} | "
                f"val_recall={val_info['recall']:.4f} | "
                f"val_f1={val_info['f1']:.4f} | "
                f"val_specificity={val_info['specificity']:.4f} | "
                f"val_pred_pos={val_info['predicted_positives']}"
            )

        if bad_epochs >= patience:
            print(f"Early stopping at epoch {ep}. Best val score={best_val_score:.4f}")
            break

    if best_state is not None:
        model.load_state_dict({
            k: v.to(data.x.device)
            for k, v in best_state.items()
        })

    model.training_summary = {"epochs_run": ep + 1, "best_validation_score": best_val_score}
    return model
