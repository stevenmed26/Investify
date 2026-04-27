from datetime import timedelta
import pandas as pd


def backtest_model(df: pd.DataFrame, model, feature_cols, horizon_days=5):
    results = []

    for i in range(len(df) - horizon_days - 1):
        train = df.iloc[:i+1]
        test = df.iloc[i+1:i+1+horizon_days]

        if len(train) < 50:
            continue

        X_train = train[feature_cols]
        y_train = train["target_return"]

        model.fit(X_train, y_train)

        last_row = train.iloc[-1:]
        pred = model.predict(last_row[feature_cols])[0]

        actual_return = (
            test["close"].iloc[-1] - last_row["close"].iloc[0]
        ) / last_row["close"].iloc[0] * 100

        results.append({
            "predicted": pred,
            "actual": actual_return
        })

    return pd.DataFrame(results)