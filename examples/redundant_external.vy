# @version ^0.3.0

# Example Vyper contract demonstrating redundant @external decorators
# This file contains violations that GasGuard should detect

# Storage variables
owner: public(address)
balance: public(uint256)
fee_rate: uint256

@external
def __init__():
    """Initialize the contract - legitimate @external"""
    self.owner = msg.sender
    self.balance = 0
    self.fee_rate = 30  # 0.3%

# VIOLATION 1: Internal naming convention with @external
# Functions starting with _ should be @internal
@external
def _calculate_fee(amount: uint256) -> uint256:
    """This function uses internal naming convention but is marked external"""
    return amount * self.fee_rate / 10000

# VIOLATION 2: Another internal-named function with @external
@external
def _validate_amount(amount: uint256) -> bool:
    """Validation helper that should be internal"""
    return amount > 0 and amount <= self.balance

# CORRECT: Properly marked internal function
@internal
def _update_balance(new_balance: uint256):
    """Internal helper - correctly marked"""
    self.balance = new_balance

# CORRECT: Legitimate external function
@external
def deposit():
    """Public deposit function - legitimate @external"""
    self.balance += msg.value

# CORRECT: Legitimate external function
@external
def withdraw(amount: uint256):
    """Public withdraw function - legitimate @external"""
    assert self._validate_amount(amount), "Invalid amount"
    fee: uint256 = self._calculate_fee(amount)
    self._update_balance(self.balance - amount)
    send(msg.sender, amount - fee)

# VIOLATION 3: Helper function only called internally
@external
def calculate_withdrawal_fee(amount: uint256) -> uint256:
    """This is only called internally but marked external"""
    return self._calculate_fee(amount)

# CORRECT: View function for external queries
@external
@view
def get_balance() -> uint256:
    """External view function - legitimate @external"""
    return self.balance

# CORRECT: External function with proper visibility
@external
def transfer(to: address, amount: uint256):
    """Transfer function - legitimate @external"""
    assert self._validate_amount(amount), "Invalid amount"
    self._update_balance(self.balance - amount)
    send(to, amount)
