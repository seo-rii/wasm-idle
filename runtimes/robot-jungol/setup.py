import os
import setuptools

readme_path = "README.md" if os.path.exists("README.md") else "readme.md"
with open(readme_path, "r") as fh:
    long_description = fh.read()

setuptools.setup(
    name="jungol-robot",
    version="0.1.0",
    author="Jeongmin Byun",
    author_email="jmbyun91@gmail.com",
    description="Grid-based robot programming environment with Pillow rendering and action logs.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://example.com/jungol-robot",
    license="MIT",
    packages=setuptools.find_packages(),
    py_modules=["robot", "robot_judge"],
    install_requires=[
        'pillow'
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.8",
)
