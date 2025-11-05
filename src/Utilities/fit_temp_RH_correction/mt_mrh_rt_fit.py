import pandas as pd
import numpy as np
import sys
import os
from sklearn.preprocessing import PolynomialFeatures
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import Pipeline

def find_optimal_equation(filepath, degree=2):
    """
    Loads data from a CSV, fits a polynomial regression model, and
    prints the resulting analytical equation.

    Args:
        filepath (str): Path to the CSV file (expected columns: MT, MH, RT).
        degree (int): The polynomial degree to use for fitting.
    """
    if not os.path.exists(filepath):
        print(f"Error: File not found at path: {filepath}", file=sys.stderr)
        sys.exit(1)

    try:
        # Load the data using pandas
        df = pd.read_csv(filepath)
    except Exception as e:
        print(f"Error reading CSV file: {e}", file=sys.stderr)
        sys.exit(1)

    # --- 1. Data Preparation ---
    # We assume the input columns are 'MT', 'MH', and the target is 'RT'.
    try:
        # X: Features (Independent variables). Must be a 2D array.
        X = df[['sens1_Temp', 'sens1_RH']].values
        # y: Target (Dependent variable). Must be a 1D array.
        y = df['sens2_Temp'].values
    except KeyError as e:
        print(f"Error: CSV is missing required column: {e}", file=sys.stderr)
        print("Expected columns are 'MT', 'MH', and 'RT'.", file=sys.stderr)
        sys.exit(1)

    # --- 2. Create and Fit the Model Pipeline ---
    # The Pipeline first creates all polynomial features (MT, MH, MT^2, MH^2, MT*MH)
    # and then fits a Linear Regression model to find the coefficients for those features.
    model = Pipeline([
        ('poly', PolynomialFeatures(degree=degree, include_bias=True)),
        ('linreg', LinearRegression())
    ])

    print(f"Fitting {degree}-degree polynomial model...")
    model.fit(X, y)
    print("Fit complete.")

    # --- 3. Extract Components and Build Equation ---

    poly_step = model.named_steps['poly']
    lin_reg_step = model.named_steps['linreg']

    # Get feature names corresponding to the coefficients
    # 'MT' and 'MH' are the original column names we provide
    feature_names = poly_step.get_feature_names_out(['MT', 'MH'])
    coefficients = lin_reg_step.coef_
    intercept = lin_reg_step.intercept_

    # Calculate the model's R-squared score (goodness of fit)
    r_squared = model.score(X, y)

    # --- 4. Print Results ---

    print("\n=======================================================")
    print(f"      ANALYTICAL EQUATION FOR CIRCUITPYTHON (DEGREE {degree})")
    print("=======================================================")
    print(f"R-squared Score (Goodness of Fit): {r_squared:.4f}")
    print("-------------------------------------------------------")

    # Start the equation with the intercept (constant term)
    equation_str = f"RT = {intercept:.6f}"

    # Iterate through coefficients, starting from index 1 (to skip the '1' bias term)
    # Note: lin_reg.coef_[0] is often 0 because the intercept handles the bias.
    for i in range(1, len(coefficients)):
        coef = coefficients[i]
        name = feature_names[i]
        
        # Determine sign and absolute value
        sign = '+' if coef >= 0 else '-'
        
        # Clean up the feature name for code use (e.g., 'MT MH' -> 'MT * MH')
        # This replaces space with ' * ' for multiplication
        clean_name = name.replace(' ', ' * ').strip() 
        
        equation_str += f" {sign} {abs(coef):.6f} * {clean_name}"

    print(equation_str)
    print("=======================================================")
    
    # --- 5. Suggest Copy-Paste Code for Microcontroller ---

    print("\nSuggested CircuitPython Code Snippet (Copy-Paste Ready):")
    print("-------------------------------------------------------")
    
    # Store coefficients in a dict for easy access
    coef_dict = {
        'C_INTERCEPT': intercept
    }
    
    # Populate the dictionary with the rest of the terms
    for i in range(1, len(coefficients)):
        name = feature_names[i].replace(' ', '_').replace('^', '_P') # e.g. 'MT MH' -> 'MT_MH'
        coef_dict[f'C_{name.upper()}'] = coefficients[i]


    # Print the coefficient definitions
    print("# --- START COEFFICIENTS (Copy these to your code.py) ---")
    for key, value in coef_dict.items():
        print(f"{key:<15} = {value:.6f}")
    print("# --- END COEFFICIENTS ---")
    
    print("\n# The prediction function for your microcontroller:")
    print("def predict_rt(mt, mh):")
    
    # Recreate the prediction logic based on the feature names
    pred_logic = f"    rt_pred = C_INTERCEPT"
    for i in range(1, len(coefficients)):
        name = feature_names[i]
        coef_key = f'C_{name.replace(" ", "_").replace("^", "_P").upper()}'
        
        # Generate the math logic (e.g., ' + C_MT * mt')
        if name == 'MT':
            term_logic = f"({coef_key} * mt)"
        elif name == 'MH':
            term_logic = f"({coef_key} * mh)"
        elif name == 'MT^2':
            term_logic = f"({coef_key} * (mt**2))"
        elif name == 'MH^2':
            term_logic = f"({coef_key} * (mh**2))"
        elif name == 'MT MH':
            term_logic = f"({coef_key} * (mt * mh))"
        else: # Catch-all for higher degrees if implemented
            term_logic = f"({coef_key} * ...)" 

        # We don't need to check sign here since we're using raw coefficients
        pred_logic += f" + \\\n              {term_logic}"
        
    print(pred_logic)
    print("    return rt_pred")
    print("-------------------------------------------------------")


if __name__ == "__main__":
    # Ensure a file path is provided as a command-line argument
    if len(sys.argv) < 2:
        print("Usage: python find_equation.py <path_to_csv_file>", file=sys.stderr)
        sys.exit(1)
        
    csv_file = sys.argv[1]
    
    # You can change the 'degree' argument here if you want to test 
    # a linear model (degree=1) or a more complex one (degree=3)
    find_optimal_equation(csv_file, degree=2)
