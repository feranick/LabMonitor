# **********************************************
# * CheckRAM - Rasperry Pico W
# * v2025.11.12.1
# * By: Nicola Ferralis <feranick@hotmail.com>
# **********************************************

import gc
import micropython

class CheckRAM:
    def __init__(self):
        pass
        
    def checkRAM(self):
        # Force a garbage collection cycle to get the most accurate free memory reading
        gc.collect()

        # Get the amount of free RAM (heap space)
        free_ram = gc.mem_free()

        # Get the total allocated RAM (heap space used by Python objects)
        allocated_ram = gc.mem_alloc()

        # Optional: Get a summary of memory usage (requires firmware built with specific features)
        # micropython.mem_info()

        print(f"--- MicroPython RAM Usage ---")
        print(f"Free RAM: {free_ram} bytes")
        print(f"Allocated RAM: {allocated_ram} bytes")
