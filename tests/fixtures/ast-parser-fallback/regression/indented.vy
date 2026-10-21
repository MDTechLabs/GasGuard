# @version ^0.3.9

owner: public(address)

struct Position:
    amount: uint256
    opened: uint256

@external
def deposit(amount: uint256):
    assert amount > 0
    self.owner = msg.sender

# trailing comment
@external
def withdraw():
    pass
